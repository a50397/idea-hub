import type { Idea, CreateIdeaInput, UpdateIdeaInput, ReviewIdeaInput, IdeaStatus } from '../types';
export declare const ideasApi: {
    getAll: (filters?: {
        status?: IdeaStatus;
        submitterId?: string;
        assigneeId?: string;
        tags?: string[];
    }) => Promise<Idea[]>;
    getOne: (id: string) => Promise<Idea>;
    create: (data: CreateIdeaInput) => Promise<Idea>;
    update: (id: string, data: UpdateIdeaInput) => Promise<Idea>;
    approve: (id: string, data?: ReviewIdeaInput) => Promise<Idea>;
    reject: (id: string, data?: ReviewIdeaInput) => Promise<Idea>;
    claim: (id: string) => Promise<Idea>;
    complete: (id: string, data?: ReviewIdeaInput) => Promise<Idea>;
};
//# sourceMappingURL=ideas.d.ts.map