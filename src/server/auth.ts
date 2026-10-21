import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './config';
import { users } from './store';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      id: string;
      email: string;
      name: string;
    };
    const user = users.find((u) => u.id === payload.id);
    if (!user) return res.status(401).json({ error: 'User account no longer exists.' });
    req.user = { id: user.id, email: user.email, name: user.name };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

export function signToken(user: { id: string; email: string; name: string }): string {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, {
    expiresIn: '7d',
  });
}
