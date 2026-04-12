import { IssueReport } from '../models/IssueReport.js';
import { getIO } from '../socket.js';

const ESCALATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const CHECK_INTERVAL_MS = 60 * 1000;          // Run every 1 minute

/**
 * Background job: Auto-escalate open issues not responded to within 10 minutes.
 * Emits 'issue_escalated' socket event to security_room so guards are re-alerted.
 */
export const initIssueEscalationService = () => {
    console.log('[EscalationService] Auto-escalation monitor started (10 min window)');

    setInterval(async () => {
        try {
            const cutoff = new Date(Date.now() - ESCALATION_WINDOW_MS);

            const stalledIssues = await IssueReport.find({
                status: 'open',
                createdAt: { $lte: cutoff }
            }).lean();

            if (stalledIssues.length === 0) return;

            const io = getIO();
            if (!io) return;

            for (const issue of stalledIssues) {
                io.to('security_room').emit('issue_escalated', {
                    _id: issue._id,
                    type: issue.type,
                    zone: issue.zone,
                    tableId: issue.tableId,
                    message: issue.message,
                    escalatedAt: new Date().toISOString(),
                    severity: 'CRITICAL'
                });
            }

            console.log(`[EscalationService] Escalated ${stalledIssues.length} unhandled issue(s)`);
        } catch (err) {
            console.error('[EscalationService] Error:', err.message);
        }
    }, CHECK_INTERVAL_MS);
};
