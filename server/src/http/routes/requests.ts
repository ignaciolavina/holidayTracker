import { Router } from 'express';
import {
  approveSchema,
  cancelSchema,
  previewSchema,
  rejectSchema,
  requestInputSchema,
  requestListQuery,
  retroactiveSchema,
  revokePreviewSchema,
  revokeSchema,
} from '@ht/shared';
import { actorOf, idParam, parse, route } from '../route';
import * as requests from '../../services/requests';
import { verifyApprovalLink } from '../../services/approvalLinks';

export function requestRoutes(): Router {
  const r = Router();
  const base = '/api/requests';
  // el cliente nunca manda "cuántos días": los schemas solo admiten fechas, y cualquier campo extra se descarta
  route(r, base, 'post', '/preview', 'auth', async (req) => requests.previewRequest(actorOf(req), parse(previewSchema, req.body)));
  route(r, base, 'post', '/retroactive', 'admin', async (req) => {
    const { confirmText: _c, ...input } = parse(retroactiveSchema, req.body);
    return requests.createRetroactive(actorOf(req), input);
  });
  route(r, base, 'post', '/', 'auth', async (req, res) => {
    const dto = await requests.createRequest(actorOf(req), parse(requestInputSchema, req.body));
    res.status(201);
    return dto;
  });
  route(r, base, 'get', '/', 'auth', async (req) => requests.listRequests(actorOf(req), parse(requestListQuery, req.query)));
  route(r, base, 'get', '/:id', 'auth', async (req) => requests.getRequestDto(actorOf(req), idParam(req)));
  route(r, base, 'post', '/:id/cancel', 'auth', async (req) =>
    requests.cancelRequest(actorOf(req), idParam(req), parse(cancelSchema, req.body).reason),
  );
  route(r, base, 'post', '/:id/approve', 'admin', async (req) =>
    requests.approveRequest(actorOf(req), idParam(req), parse(approveSchema, req.body)),
  );
  route(r, base, 'post', '/:id/reject', 'admin', async (req) =>
    requests.rejectRequest(actorOf(req), idParam(req), parse(rejectSchema, req.body).reason),
  );
  route(r, base, 'post', '/:id/revoke/preview', 'admin', async (req) =>
    requests.revokePreview(actorOf(req), idParam(req), parse(revokePreviewSchema, req.body).fromDate),
  );
  route(r, base, 'post', '/:id/revoke', 'admin', async (req) => {
    const { fromDate, reason } = parse(revokeSchema, req.body);
    return requests.revokeRequest(actorOf(req), idParam(req), { fromDate, reason });
  });
  return r;
}

export function approvalRoutes(): Router {
  const r = Router();
  route(r, '/api/approvals', 'get', '/link/:token', 'auth', async (req) => ({
    requestId: verifyApprovalLink(String(req.params.token), actorOf(req).id!),
  }));
  return r;
}
