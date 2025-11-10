export declare enum Role {
    USER = "USER",
    POWER_USER = "POWER_USER",
    ADMIN = "ADMIN"
}
export declare enum IdeaStatus {
    SUBMITTED = "SUBMITTED",
    APPROVED = "APPROVED",
    IN_PROGRESS = "IN_PROGRESS",
    DONE = "DONE",
    REJECTED = "REJECTED"
}
export declare enum Effort {
    LESS_THAN_ONE_DAY = "LESS_THAN_ONE_DAY",
    ONE_TO_THREE_DAYS = "ONE_TO_THREE_DAYS",
    MORE_THAN_THREE_DAYS = "MORE_THAN_THREE_DAYS"
}
export declare enum EventType {
    SUBMITTED = "SUBMITTED",
    APPROVED = "APPROVED",
    REJECTED = "REJECTED",
    CLAIMED = "CLAIMED",
    STARTED = "STARTED",
    COMPLETED = "COMPLETED",
    UPDATED = "UPDATED",
    CHANGE_REQUESTED = "CHANGE_REQUESTED"
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
export declare const effortLabels: Record<Effort, string>;
export declare const statusLabels: Record<IdeaStatus, string>;
export declare const statusColors: Record<IdeaStatus, string>;
//# sourceMappingURL=index.d.ts.map