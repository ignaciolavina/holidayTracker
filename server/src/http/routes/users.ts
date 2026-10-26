import { Router } from 'express';
import { deactivateSchema, inviteSchema, updateUserSchema } from '@ht/shared';
import { actorOf, idParam, parse, route } from '../route';
import * as users from '../../services/users';

export function userRoutes(): Router {
  const r = Router();
  const base = '/api/users';
  route(r, base, 'get', '/', 'auth', async (req) => users.listUsers(actorOf(req)));
  route(r, base, 'get', '/:id', 'admin', async (req) => users.getUserDetail(idParam(req)));
  route(r, base, 'patch', '/:id', 'admin', async (req) =>
    users.updateUser(actorOf(req), idParam(req), parse(updateUserSchema, req.body)),
  );
  route(r, base, 'post', '/:id/deactivate', 'admin', async (req) => {
    const { leaveDate, reason } = parse(deactivateSchema, req.body);
    return users.deactivateUser(actorOf(req), idParam(req), leaveDate, reason);
  });
  route(r, base, 'post', '/:id/reactivate', 'admin', async (req) => users.reactivateUser(actorOf(req), idParam(req)));
  route(r, base, 'get', '/:id/settlement', 'admin', async (req) => users.getSettlement(idParam(req)));
  return r;
}

export function invitationRoutes(): Router {
  const r = Router();
  const base = '/api/invitations';
  route(r, base, 'get', '/', 'admin', async () => users.listInvitations());
  route(r, base, 'post', '/', 'admin', async (req) => users.inviteUser(actorOf(req), parse(inviteSchema, req.body)));
  route(r, base, 'post', '/:id/resend', 'admin', async (req) => users.resendInvitation(actorOf(req), idParam(req)));
  route(r, base, 'post', '/:id/revoke', 'admin', async (req) => users.revokeInvitation(actorOf(req), idParam(req)));
  return r;
}

export function orgRoutes(): Router {
  const r = Router();
  route(r, '/api/org', 'get', '/tree', 'auth', async (req) => users.orgTree(actorOf(req)));
  return r;
}
