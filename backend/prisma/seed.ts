import { PrismaClient, Role, IdeaStatus, Effort, EventType } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Clear existing data
  await prisma.ideaEvent.deleteMany();
  await prisma.idea.deleteMany();
  await prisma.user.deleteMany();

  // Create users
  const adminPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'admin@ideahub.com',
      passwordHash: adminPassword,
      role: Role.ADMIN,
    },
  });

  const powerUserPassword = await bcrypt.hash('power123', 10);
  const powerUser = await prisma.user.create({
    data: {
      name: 'Power User',
      email: 'power@ideahub.com',
      passwordHash: powerUserPassword,
      role: Role.POWER_USER,
    },
  });

  const user1Password = await bcrypt.hash('user123', 10);
  const user1 = await prisma.user.create({
    data: {
      name: 'John Doe',
      email: 'john@ideahub.com',
      passwordHash: user1Password,
      role: Role.USER,
    },
  });

  const user2Password = await bcrypt.hash('user123', 10);
  const user2 = await prisma.user.create({
    data: {
      name: 'Jane Smith',
      email: 'jane@ideahub.com',
      passwordHash: user2Password,
      role: Role.USER,
    },
  });

  const user3Password = await bcrypt.hash('user123', 10);
  const user3 = await prisma.user.create({
    data: {
      name: 'Bob Johnson',
      email: 'bob@ideahub.com',
      passwordHash: user3Password,
      role: Role.USER,
    },
  });

  console.log('Created users:', {
    admin: admin.email,
    powerUser: powerUser.email,
    users: [user1.email, user2.email, user3.email],
  });

  // Create ideas in different states
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Submitted ideas (waiting for review)
  const submittedIdea1 = await prisma.idea.create({
    data: {
      title: 'Improve Employee Onboarding Process',
      description:
        'Create a digital onboarding checklist that guides new employees through their first week. This would include automated task assignments, introduction scheduling, and progress tracking.',
      benefits:
        'Reduces HR workload by 30%, ensures consistent onboarding experience, and helps new employees feel more welcomed and prepared.',
      effort: Effort.ONE_TO_THREE_DAYS,
      status: IdeaStatus.SUBMITTED,
      submitterId: user1.id,
      tags: ['hr', 'automation', 'employee-experience'],
      submittedAt: yesterday,
    },
  });

  await prisma.ideaEvent.create({
    data: {
      ideaId: submittedIdea1.id,
      type: EventType.SUBMITTED,
      byUserId: user1.id,
      timestamp: yesterday,
      note: 'Initial submission',
    },
  });

  const submittedIdea2 = await prisma.idea.create({
    data: {
      title: 'Implement Standing Desk Policy',
      description:
        'Allow employees to request standing desks or desk converters. Create a process for evaluation and approval based on medical needs or personal preference.',
      benefits:
        'Improves employee health and wellbeing, reduces back pain complaints, increases productivity and morale.',
      effort: Effort.LESS_THAN_ONE_DAY,
      status: IdeaStatus.SUBMITTED,
      submitterId: user2.id,
      tags: ['health', 'workplace', 'equipment'],
      submittedAt: now,
    },
  });

  await prisma.ideaEvent.create({
    data: {
      ideaId: submittedIdea2.id,
      type: EventType.SUBMITTED,
      byUserId: user2.id,
      timestamp: now,
      note: 'Initial submission',
    },
  });

  // Approved ideas (ready to be claimed)
  const approvedIdea1 = await prisma.idea.create({
    data: {
      title: 'Create Internal Knowledge Base',
      description:
        'Set up a searchable wiki-style knowledge base where teams can document processes, best practices, and frequently asked questions. Use an open-source solution like WikiJS or BookStack.',
      benefits:
        'Reduces repetitive questions, preserves institutional knowledge, speeds up problem-solving, and improves cross-team collaboration.',
      effort: Effort.MORE_THAN_THREE_DAYS,
      status: IdeaStatus.APPROVED,
      submitterId: user1.id,
      approverId: powerUser.id,
      tags: ['knowledge-management', 'documentation', 'collaboration'],
      submittedAt: lastWeek,
      approvedAt: new Date(lastWeek.getTime() + 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.ideaEvent.createMany({
    data: [
      {
        ideaId: approvedIdea1.id,
        type: EventType.SUBMITTED,
        byUserId: user1.id,
        timestamp: lastWeek,
        note: 'Initial submission',
      },
      {
        ideaId: approvedIdea1.id,
        type: EventType.APPROVED,
        byUserId: powerUser.id,
        timestamp: new Date(lastWeek.getTime() + 2 * 24 * 60 * 60 * 1000),
        note: 'Great idea! This will help everyone.',
      },
    ],
  });

  const approvedIdea2 = await prisma.idea.create({
    data: {
      title: 'Automate Weekly Status Reports',
      description:
        'Create a simple form and automation that compiles weekly status updates from all team members into a single digest email. This reduces the time managers spend collecting updates.',
      benefits:
        'Saves 2-3 hours per week per manager, standardizes reporting format, creates historical record of team progress.',
      effort: Effort.ONE_TO_THREE_DAYS,
      status: IdeaStatus.APPROVED,
      submitterId: user3.id,
      approverId: powerUser.id,
      tags: ['automation', 'reporting', 'productivity'],
      submittedAt: lastWeek,
      approvedAt: new Date(lastWeek.getTime() + 1 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.ideaEvent.createMany({
    data: [
      {
        ideaId: approvedIdea2.id,
        type: EventType.SUBMITTED,
        byUserId: user3.id,
        timestamp: lastWeek,
        note: 'Initial submission',
      },
      {
        ideaId: approvedIdea2.id,
        type: EventType.APPROVED,
        byUserId: powerUser.id,
        timestamp: new Date(lastWeek.getTime() + 1 * 24 * 60 * 60 * 1000),
        note: 'Approved for implementation',
      },
    ],
  });

  // In-progress ideas (claimed and being worked on)
  const inProgressIdea = await prisma.idea.create({
    data: {
      title: 'Implement Green Office Initiative',
      description:
        'Introduce recycling stations on each floor, switch to compostable utensils in the kitchen, and set up a system for employees to track and reduce waste.',
      benefits:
        'Reduces company environmental impact, improves corporate social responsibility profile, saves costs on waste management over time.',
      effort: Effort.ONE_TO_THREE_DAYS,
      status: IdeaStatus.IN_PROGRESS,
      submitterId: user2.id,
      approverId: powerUser.id,
      assigneeId: user2.id,
      tags: ['sustainability', 'environment', 'csr'],
      submittedAt: lastMonth,
      approvedAt: new Date(lastMonth.getTime() + 3 * 24 * 60 * 60 * 1000),
      startedAt: new Date(lastMonth.getTime() + 5 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.ideaEvent.createMany({
    data: [
      {
        ideaId: inProgressIdea.id,
        type: EventType.SUBMITTED,
        byUserId: user2.id,
        timestamp: lastMonth,
        note: 'Initial submission',
      },
      {
        ideaId: inProgressIdea.id,
        type: EventType.APPROVED,
        byUserId: powerUser.id,
        timestamp: new Date(lastMonth.getTime() + 3 * 24 * 60 * 60 * 1000),
        note: 'Great initiative!',
      },
      {
        ideaId: inProgressIdea.id,
        type: EventType.CLAIMED,
        byUserId: user2.id,
        timestamp: new Date(lastMonth.getTime() + 5 * 24 * 60 * 60 * 1000),
        note: 'I will implement this',
      },
    ],
  });

  // Completed ideas
  const completedIdea1 = await prisma.idea.create({
    data: {
      title: 'Set Up Coffee Subscription Service',
      description:
        'Replace instant coffee with a monthly subscription to a local coffee roaster. Set up a brewing station with quality equipment.',
      benefits:
        'Improves employee satisfaction, supports local business, creates a better break room atmosphere.',
      effort: Effort.LESS_THAN_ONE_DAY,
      status: IdeaStatus.DONE,
      submitterId: user3.id,
      approverId: admin.id,
      assigneeId: admin.id,
      tags: ['employee-experience', 'perks'],
      submittedAt: new Date(lastMonth.getTime() - 10 * 24 * 60 * 60 * 1000),
      approvedAt: new Date(lastMonth.getTime() - 8 * 24 * 60 * 60 * 1000),
      startedAt: new Date(lastMonth.getTime() - 7 * 24 * 60 * 60 * 1000),
      completedAt: new Date(lastMonth.getTime() - 6 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.ideaEvent.createMany({
    data: [
      {
        ideaId: completedIdea1.id,
        type: EventType.SUBMITTED,
        byUserId: user3.id,
        timestamp: new Date(lastMonth.getTime() - 10 * 24 * 60 * 60 * 1000),
        note: 'Initial submission',
      },
      {
        ideaId: completedIdea1.id,
        type: EventType.APPROVED,
        byUserId: admin.id,
        timestamp: new Date(lastMonth.getTime() - 8 * 24 * 60 * 60 * 1000),
        note: 'Quick win!',
      },
      {
        ideaId: completedIdea1.id,
        type: EventType.CLAIMED,
        byUserId: admin.id,
        timestamp: new Date(lastMonth.getTime() - 7 * 24 * 60 * 60 * 1000),
        note: 'Will set this up',
      },
      {
        ideaId: completedIdea1.id,
        type: EventType.COMPLETED,
        byUserId: admin.id,
        timestamp: new Date(lastMonth.getTime() - 6 * 24 * 60 * 60 * 1000),
        note: 'Coffee station is ready!',
      },
    ],
  });

  const completedIdea2 = await prisma.idea.create({
    data: {
      title: 'Flexible Work Hours Policy',
      description:
        'Allow employees to choose their start time between 7 AM and 10 AM, as long as they complete 8 hours and attend required meetings.',
      benefits:
        'Improves work-life balance, reduces commute stress, increases employee satisfaction and retention.',
      effort: Effort.LESS_THAN_ONE_DAY,
      status: IdeaStatus.DONE,
      submitterId: user1.id,
      approverId: admin.id,
      assigneeId: powerUser.id,
      tags: ['policy', 'work-life-balance', 'flexibility'],
      submittedAt: new Date(lastMonth.getTime() - 15 * 24 * 60 * 60 * 1000),
      approvedAt: new Date(lastMonth.getTime() - 12 * 24 * 60 * 60 * 1000),
      startedAt: new Date(lastMonth.getTime() - 10 * 24 * 60 * 60 * 1000),
      completedAt: new Date(lastMonth.getTime() - 5 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.ideaEvent.createMany({
    data: [
      {
        ideaId: completedIdea2.id,
        type: EventType.SUBMITTED,
        byUserId: user1.id,
        timestamp: new Date(lastMonth.getTime() - 15 * 24 * 60 * 60 * 1000),
        note: 'Initial submission',
      },
      {
        ideaId: completedIdea2.id,
        type: EventType.APPROVED,
        byUserId: admin.id,
        timestamp: new Date(lastMonth.getTime() - 12 * 24 * 60 * 60 * 1000),
        note: 'Excellent suggestion',
      },
      {
        ideaId: completedIdea2.id,
        type: EventType.CLAIMED,
        byUserId: powerUser.id,
        timestamp: new Date(lastMonth.getTime() - 10 * 24 * 60 * 60 * 1000),
        note: 'Will draft the policy',
      },
      {
        ideaId: completedIdea2.id,
        type: EventType.COMPLETED,
        byUserId: powerUser.id,
        timestamp: new Date(lastMonth.getTime() - 5 * 24 * 60 * 60 * 1000),
        note: 'Policy approved and announced to all teams',
      },
    ],
  });

  // Rejected idea
  const rejectedIdea = await prisma.idea.create({
    data: {
      title: 'Install Nap Pods',
      description:
        'Purchase and install nap pods in a quiet area for employees to take power naps during breaks.',
      benefits: 'Could improve alertness and productivity after lunch.',
      effort: Effort.MORE_THAN_THREE_DAYS,
      status: IdeaStatus.REJECTED,
      submitterId: user2.id,
      approverId: powerUser.id,
      tags: ['wellness', 'workplace'],
      submittedAt: new Date(lastMonth.getTime() - 20 * 24 * 60 * 60 * 1000),
      rejectedAt: new Date(lastMonth.getTime() - 18 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.ideaEvent.createMany({
    data: [
      {
        ideaId: rejectedIdea.id,
        type: EventType.SUBMITTED,
        byUserId: user2.id,
        timestamp: new Date(lastMonth.getTime() - 20 * 24 * 60 * 60 * 1000),
        note: 'Initial submission',
      },
      {
        ideaId: rejectedIdea.id,
        type: EventType.REJECTED,
        byUserId: powerUser.id,
        timestamp: new Date(lastMonth.getTime() - 18 * 24 * 60 * 60 * 1000),
        note: 'Budget constraints and space limitations make this unfeasible at this time.',
      },
    ],
  });

  console.log('Seed data created successfully!');
  console.log('\nTest Accounts:');
  console.log('Admin: admin@ideahub.com / admin123');
  console.log('Power User: power@ideahub.com / power123');
  console.log('User 1: john@ideahub.com / user123');
  console.log('User 2: jane@ideahub.com / user123');
  console.log('User 3: bob@ideahub.com / user123');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
