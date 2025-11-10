import type { UserWithCounts, CreateUserInput, UpdateUserInput } from '../types';
export declare const usersApi: {
    getAll: () => Promise<UserWithCounts[]>;
    getOne: (id: string) => Promise<UserWithCounts>;
    create: (data: CreateUserInput) => Promise<UserWithCounts>;
    update: (id: string, data: UpdateUserInput) => Promise<UserWithCounts>;
    delete: (id: string) => Promise<void>;
};
//# sourceMappingURL=users.d.ts.map