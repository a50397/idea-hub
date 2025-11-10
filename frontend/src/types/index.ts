export enum Role {
  USER = 'USER',
  POWER_USER = 'POWER_USER',
  ADMIN = 'ADMIN',
}

export enum IdeaStatus {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  REJECTED = 'REJECTED',
}

export enum Effort {
  LESS_THAN_ONE_DAY = 'LESS_THAN_ONE_DAY',
  ONE_TO_THREE_DAYS = 'ONE_TO_THREE_DAYS',
  MORE_THAN_THREE_DAYS = 'MORE_THAN_THREE_DAYS',
}

export enum EventType {
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CLAIMED = 'CLAIMED',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  UPDATED = 'UPDATED',
  CHANGE_REQUESTED = 'CHANGE_REQUESTED',
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserWithCounts extends User {
  _count?: {
    submittedIdeas: number;
    approvedIdeas: number;
    assignedIdeas: number;
  };
}

export interface Idea {
  id: string;
  title: string;
  description: string;
  benefits: string;
  effort: Effort;
  status: IdeaStatus;
  tags: string[];
  submitterId: string;
  submitter: User;
  approverId?: string;
  approver?: User;
  assigneeId?: string;
  assignee?: User;
  submittedAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt: string;
  events?: IdeaEvent[];
}

export interface IdeaEvent {
  id: string;
  ideaId: string;
  type: EventType;
  byUserId: string;
  byUser: User;
  timestamp: string;
  note?: string;
}

export interface CreateIdeaInput {
  title: string;
  description: string;
  benefits: string;
  effort: Effort;
  tags?: string[];
}

export interface UpdateIdeaInput {
  title?: string;
  description?: string;
  benefits?: string;
  effort?: Effort;
  tags?: string[];
}

export interface ReviewIdeaInput {
  note?: string;
}

export interface DashboardSummary {
  counts: {
    submitted: number;
    approved: number;
    inProgress: number;
    done: number;
    rejected: number;
    total: number;
  };
  averageTimes: {
    submittedToApprovedDays: number;
    approvedToDoneDays: number;
  };
}

export interface MonthlyTrend {
  month: string;
  count: number;
}

export interface TopContributor {
  userId: string;
  userName: string;
  userEmail: string;
  completedIdeas: number;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: Role;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: Role;
}

export const effortLabels: Record<Effort, string> = {
  [Effort.LESS_THAN_ONE_DAY]: '< 1 day',
  [Effort.ONE_TO_THREE_DAYS]: '1-3 days',
  [Effort.MORE_THAN_THREE_DAYS]: '> 3 days',
};

export const statusLabels: Record<IdeaStatus, string> = {
  [IdeaStatus.SUBMITTED]: 'Submitted',
  [IdeaStatus.APPROVED]: 'Approved',
  [IdeaStatus.IN_PROGRESS]: 'In Progress',
  [IdeaStatus.DONE]: 'Done',
  [IdeaStatus.REJECTED]: 'Rejected',
};

export const statusColors: Record<IdeaStatus, string> = {
  [IdeaStatus.SUBMITTED]: 'info',
  [IdeaStatus.APPROVED]: 'success',
  [IdeaStatus.IN_PROGRESS]: 'warning',
  [IdeaStatus.DONE]: 'primary',
  [IdeaStatus.REJECTED]: 'error',
};
