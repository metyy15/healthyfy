import { Request, Response, Router } from 'express';
import { authenticateToken } from '../auth';
import {
  compareReports,
  findReportsToCompare,
} from '../ai/compare';
import {
  attachReminder,
  createFollowUpTask,
  extractFollowUpTasks,
  upcomingTasks,
} from '../ai/followUp';
import {
  familyMembers,
  followUpTasks,
  medicalReports,
  persistState,
} from '../store';
import { FollowUpKind, FollowUpTask } from '../types';

export const compareRouter = Router();
compareRouter.use(authenticateToken);

// -------------------------------------------------------------
// Report comparison
// -------------------------------------------------------------

/**
 * Compare two stored reports.
 *
 * Without report ids the two most recent reports of the same panel are
 * used, which is what "compare my latest test with the previous one"
 * almost always means. The comparison is computed from the stored
 * values, not generated, so it is reproducible and never invents a
 * value.
 */
compareRouter.get('/records/compare', (req: Request, res: Response) => {
  const memberId = String(req.query.memberId || '');
  const olderId = req.query.olderId ? String(req.query.olderId) : undefined;
  const latestId = req.query.latestId ? String(req.query.latestId) : undefined;

  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(404).json({ error: 'Family member not found.' });
  }

  const { older, latest, reason } = findReportsToCompare(memberId, olderId, latestId);
  if (!older || !latest) {
    return res.json({
      comparable: false,
      reason,
      memberId,
      memberName: member.name,
      availableReports: medicalReports
        .filter((r) => r.memberId === memberId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((r) => ({
          id: r.id,
          reportType: r.reportType,
          title: r.title,
          date: r.date,
        })),
    });
  }

  const result = compareReports(memberId, older, latest);
  res.json({
    comparable: true,
    ...result,
    availableReports: medicalReports
      .filter((r) => r.memberId === memberId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map((r) => ({
        id: r.id,
        reportType: r.reportType,
        title: r.title,
        date: r.date,
      })),
  });
});

// -------------------------------------------------------------
// Follow-up tracker
// -------------------------------------------------------------

compareRouter.get('/follow-up', (req: Request, res: Response) => {
  const memberId = req.query.memberId ? String(req.query.memberId) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;

  let list = followUpTasks.filter((t) => t.userId === req.user!.id);
  if (memberId) list = list.filter((t) => t.memberId === memberId);
  if (status) list = list.filter((t) => t.status === status);

  res.json(
    list.sort((a, b) => {
      const dateA = a.dueDate || '9999-12-31';
      const dateB = b.dueDate || '9999-12-31';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.createdAt.localeCompare(b.createdAt);
    })
  );
});

/**
 * Read visit instructions and propose tasks.
 *
 * Nothing is saved. The extraction is a proposal the user confirms,
 * because the app must not silently act on a document it may have
 * misread.
 */
compareRouter.post('/follow-up/extract', async (req: Request, res: Response) => {
  const { memberId, imageBase64, imageMimeType, text, sourceLabel } = req.body || {};

  if (!memberId) return res.status(400).json({ error: 'Family member is required.' });
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only add records for your own family members.' });
  }
  if (!imageBase64 && !text) {
    return res
      .status(400)
      .json({ error: 'Upload a photo of the visit instructions or paste the text.' });
  }

  try {
    const extraction = await extractFollowUpTasks({
      userId: req.user!.id,
      memberId,
      imageBase64,
      imageMimeType,
      text,
      sourceLabel:
        sourceLabel || `Visit instructions added on ${new Date().toLocaleDateString('en-GB')}`,
    });

    res.json({
      memberId,
      memberName: member.name,
      ...extraction,
      saved: false,
      notice:
        'Nothing has been saved yet. Check each item below and confirm the ones that are right.',
    });
  } catch (error: any) {
    console.error('Follow-up extraction failed:', error);
    res.status(502).json({
      error:
        'The visit instructions could not be read right now. No task was created and nothing was assumed about the document.',
    });
  }
});

/**
 * Save confirmed tasks. The client sends only the items the user
 * actually accepted, so the server never has to guess what was
 * approved.
 */
compareRouter.post('/follow-up', async (req: Request, res: Response) => {
  const { memberId, items, sourceLabel } = req.body || {};

  if (!memberId) return res.status(400).json({ error: 'Family member is required.' });
  const member = familyMembers.find((f) => f.id === memberId && f.userId === req.user!.id);
  if (!member) {
    return res.status(403).json({ error: 'You can only add records for your own family members.' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Select at least one item to save.' });
  }

  const label = sourceLabel || `Visit instructions added on ${new Date().toLocaleDateString('en-GB')}`;
  const created: FollowUpTask[] = [];

  for (const item of items) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;
    const kind: FollowUpKind = (
      [
        'appointment',
        'test',
        'bring_records',
        'review_instructions',
        'medication_review',
        'other',
      ].includes(item.kind)
        ? item.kind
        : 'other'
    ) as FollowUpKind;

    const task = createFollowUpTask({
      userId: req.user!.id,
      memberId,
      title: item.title.trim(),
      ...(typeof item.detail === 'string' && item.detail.trim() ? { detail: item.detail.trim() } : {}),
      kind,
      ...(typeof item.dueDate === 'string' && item.dueDate.trim() ? { dueDate: item.dueDate.trim() } : {}),
      ...(typeof item.dueTime === 'string' && item.dueTime.trim() ? { dueTime: item.dueTime.trim() } : {}),
      source: 'visit_instructions',
      sourceLabel: label,
      ...(typeof item.safetyNote === 'string' ? { safetyNote: item.safetyNote } : {}),
    });

    followUpTasks.push(task);
    created.push(task);
  }

  await persistState();
  res.status(201).json({ created, count: created.length });
});

compareRouter.post('/follow-up/:id/complete', async (req: Request, res: Response) => {
  const task = followUpTasks.find((t) => t.id === req.params.id && t.userId === req.user!.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  task.status = 'done';
  task.completedAt = new Date().toISOString();

  // A completed task should not keep nagging.
  if (task.reminderId) {
    const reminder = (await import('../store')).reminders.find((r) => r.id === task.reminderId);
    if (reminder) reminder.enabled = false;
  }

  await persistState();
  res.json(task);
});

compareRouter.post('/follow-up/:id/dismiss', async (req: Request, res: Response) => {
  const task = followUpTasks.find((t) => t.id === req.params.id && t.userId === req.user!.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  task.status = 'dismissed';
  task.completedAt = new Date().toISOString();

  if (task.reminderId) {
    const reminder = (await import('../store')).reminders.find((r) => r.id === task.reminderId);
    if (reminder) reminder.enabled = false;
  }

  await persistState();
  res.json(task);
});

/**
 * Attach a real reminder to a task.
 *
 * The response says plainly whether a notification was scheduled. It
 * never claims a message was sent to anyone else.
 */
compareRouter.post('/follow-up/:id/remind', async (req: Request, res: Response) => {
  const task = followUpTasks.find((t) => t.id === req.params.id && t.userId === req.user!.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const { dueDate, dueTime } = req.body || {};
  if (dueDate) task.dueDate = String(dueDate);
  if (dueTime) task.dueTime = String(dueTime);

  const result = attachReminder(task);
  await persistState();
  res.json(result);
});

/**
 * "What do I need to do this week?"
 */
compareRouter.get('/follow-up/upcoming', (req: Request, res: Response) => {
  const memberId = req.query.memberId ? String(req.query.memberId) : undefined;
  const days = Number(req.query.days) > 0 ? Number(req.query.days) : 7;
  const grouped = upcomingTasks(req.user!.id, memberId, days);

  const all = [
    ...grouped.overdue,
    ...grouped.today,
    ...grouped.thisWeek,
    ...grouped.later,
  ];

  res.json({
    ...grouped,
    days,
    summary:
      all.length === 0
        ? `Nothing is outstanding for the next ${days} days.`
        : `${grouped.overdue.length} overdue, ${grouped.today.length} due today and ${
            grouped.thisWeek.length
          } due in the next ${days} days.`,
  });
});
