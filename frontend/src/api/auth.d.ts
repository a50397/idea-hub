import type { User } from '../types';
export declare const authApi: {
    login: (email: string, password: string) => Promise<User>;
    logout: () => Promise<void>;
    getCurrentUser: () => Promise<User>;
};
//# sourceMappingURL=auth.d.ts.map