// Unit coverage for utils/lifecycle-notify.ts, focused on the change the Jira
// integration made to it: the actor may now be NULL (the poller has no human actor).
//
// The request-path behavior (opt-in, per-channel isolation, both channels firing
// from one opt-in) is exercised end-to-end in ideas.test.ts; this suite pins the
// guard semantics directly, because "a null actor must never be mistaken for the
// submitter" is exactly the kind of rule a refactor could silently invert.
//
// Both channels are mocked; the template modules are REAL, so the assertions below
// see the wording an actual notification would carry.

jest.mock('../utils/mailer', () => ({ sendMail: jest.fn().mockResolvedValue(true) }));
jest.mock('../config/mail', () => ({ getEffectiveMailConfig: jest.fn() }));
jest.mock('../utils/webex', () => ({
  getEffectiveWebexConfig: jest.fn(),
  sendWebexMessage: jest.fn().mockResolvedValue(true),
}));

import { maybeNotifySubmitter, JIRA_ACTOR_NAME } from '../utils/lifecycle-notify';
import { sendMail } from '../utils/mailer';
import { getEffectiveMailConfig } from '../config/mail';
import { sendWebexMessage, getEffectiveWebexConfig } from '../utils/webex';

const mockedSendMail = jest.mocked(sendMail);
const mockedMailConfig = jest.mocked(getEffectiveMailConfig);
const mockedSendWebex = jest.mocked(sendWebexMessage);
const mockedWebexConfig = jest.mocked(getEffectiveWebexConfig);

// The notification is fire-and-forget (an async IIFE per channel); flush the
// microtask/immediate queue so those awaits settle before asserting.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const SUBMITTER = { id: 'submitter1', name: 'Sub Mitter', email: 'submitter@example.com' };

function idea(overrides: Record<string, unknown> = {}) {
  return {
    id: 'idea1',
    title: 'Notifiable idea',
    notifyOnChange: true,
    submitterId: SUBMITTER.id,
    submitter: SUBMITTER,
    ...overrides,
  } as Parameters<typeof maybeNotifySubmitter>[0]['idea'];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSendMail.mockResolvedValue(true);
  mockedSendWebex.mockResolvedValue(true);
  mockedMailConfig.mockResolvedValue({ language: 'en', subjectTemplate: '', effectiveEnabled: true } as any);
  mockedWebexConfig.mockResolvedValue({ effectiveEnabled: true, language: 'en' } as any);
});

describe('maybeNotifySubmitter — actor semantics', () => {
  it('exposes the constant Jira actor label (never a remote display name)', () => {
    expect(JIRA_ACTOR_NAME).toBe('Jira');
  });

  // The Jira poller path: no human actor at all.
  it('NOTIFIES on both channels when the actor is null (the Jira poller)', async () => {
    maybeNotifySubmitter({
      idea: idea(),
      event: 'JIRA_STARTED',
      actorUserId: null,
      actorName: JIRA_ACTOR_NAME,
      jiraKey: 'OPS-1',
    });
    await flushAsync();

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(mockedSendWebex).toHaveBeenCalledTimes(1);
    const mail = mockedSendMail.mock.calls[0][0];
    expect(mail.to).toBe(SUBMITTER.email);
    expect(mail.subject).toBe('[IdeaHub] Work has started on your idea: Notifiable idea');
    // The body names the ISSUE, and no assignee name is anywhere in it.
    expect(mail.text).toContain('OPS-1');
  });

  // The regression this test exists for: a null actor compared loosely against a
  // null/undefined submitterId must NOT bail as a self-notification.
  it('does not treat a null actor as the submitter even when submitterId is nullish', async () => {
    maybeNotifySubmitter({
      idea: idea({ submitterId: null as unknown as string }),
      event: 'JIRA_COMPLETED',
      actorUserId: null,
      actorName: JIRA_ACTOR_NAME,
      jiraKey: 'OPS-1',
    });
    await flushAsync();

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
  });

  it('still bails for a genuine self-notification (a user acting on their own idea)', async () => {
    maybeNotifySubmitter({
      idea: idea(),
      event: 'APPROVED',
      actorUserId: SUBMITTER.id,
      actorName: 'Sub Mitter',
    });
    await flushAsync();

    expect(mockedSendMail).not.toHaveBeenCalled();
    expect(mockedSendWebex).not.toHaveBeenCalled();
    // A synchronous bail: neither channel's settings are even read.
    expect(mockedMailConfig).not.toHaveBeenCalled();
    expect(mockedWebexConfig).not.toHaveBeenCalled();
  });

  it.each([
    ['the submitter opted out', { notifyOnChange: false }],
    ['the opt-in is a legacy null', { notifyOnChange: null }],
    ['the submitter has no email', { submitter: { ...SUBMITTER, email: '' } }],
    ['there is no submitter record', { submitter: null }],
  ])('bails (nothing sent, no settings read) when %s — even for a Jira milestone', async (_label, overrides) => {
    maybeNotifySubmitter({
      idea: idea(overrides),
      event: 'JIRA_CANCELLED',
      actorUserId: null,
      actorName: JIRA_ACTOR_NAME,
      jiraKey: 'OPS-1',
    });
    await flushAsync();

    expect(mockedSendMail).not.toHaveBeenCalled();
    expect(mockedSendWebex).not.toHaveBeenCalled();
    expect(mockedMailConfig).not.toHaveBeenCalled();
    expect(mockedWebexConfig).not.toHaveBeenCalled();
  });

  it('passes the Jira key through to BOTH channel templates', async () => {
    maybeNotifySubmitter({
      idea: idea(),
      event: 'JIRA_CANCELLED',
      actorUserId: null,
      actorName: JIRA_ACTOR_NAME,
      jiraKey: 'OPS-42',
    });
    await flushAsync();

    expect(mockedSendMail.mock.calls[0][0].text).toContain('OPS-42');
    // The Webex body escapes the key's hyphen (every remote inline value is escaped).
    const markdown = (mockedSendWebex.mock.calls[0][0] as { markdown: string }).markdown;
    expect(markdown).toContain('OPS\\-42');
  });

  it('keeps the channels independent for a Jira milestone (a mail failure does not stop Webex)', async () => {
    mockedSendMail.mockRejectedValue(new Error('smtp down'));

    maybeNotifySubmitter({
      idea: idea(),
      event: 'JIRA_COMPLETED',
      actorUserId: null,
      actorName: JIRA_ACTOR_NAME,
      jiraKey: 'OPS-1',
    });
    await flushAsync();

    expect(mockedSendMail).toHaveBeenCalledTimes(1);
    expect(mockedSendWebex).toHaveBeenCalledTimes(1);
  });
});
