import type { User } from '../types';
import { Role } from '../types';
export declare const useAuthStore: import("pinia").StoreDefinition<"auth", Pick<{
    user: import("vue").Ref<{
        id: string;
        name: string;
        email: string;
        role: Role;
        createdAt?: string | undefined;
        updatedAt?: string | undefined;
    } | null, User | {
        id: string;
        name: string;
        email: string;
        role: Role;
        createdAt?: string | undefined;
        updatedAt?: string | undefined;
    } | null>;
    loading: import("vue").Ref<boolean, boolean>;
    error: import("vue").Ref<string | null, string | null>;
    isAuthenticated: import("vue").ComputedRef<boolean>;
    isAdmin: import("vue").ComputedRef<boolean>;
    isPowerUser: import("vue").ComputedRef<boolean>;
    isUser: import("vue").ComputedRef<boolean>;
    login: (email: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
    checkAuth: () => Promise<boolean>;
}, "error" | "user" | "loading">, Pick<{
    user: import("vue").Ref<{
        id: string;
        name: string;
        email: string;
        role: Role;
        createdAt?: string | undefined;
        updatedAt?: string | undefined;
    } | null, User | {
        id: string;
        name: string;
        email: string;
        role: Role;
        createdAt?: string | undefined;
        updatedAt?: string | undefined;
    } | null>;
    loading: import("vue").Ref<boolean, boolean>;
    error: import("vue").Ref<string | null, string | null>;
    isAuthenticated: import("vue").ComputedRef<boolean>;
    isAdmin: import("vue").ComputedRef<boolean>;
    isPowerUser: import("vue").ComputedRef<boolean>;
    isUser: import("vue").ComputedRef<boolean>;
    login: (email: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
    checkAuth: () => Promise<boolean>;
}, "isAuthenticated" | "isAdmin" | "isPowerUser" | "isUser">, Pick<{
    user: import("vue").Ref<{
        id: string;
        name: string;
        email: string;
        role: Role;
        createdAt?: string | undefined;
        updatedAt?: string | undefined;
    } | null, User | {
        id: string;
        name: string;
        email: string;
        role: Role;
        createdAt?: string | undefined;
        updatedAt?: string | undefined;
    } | null>;
    loading: import("vue").Ref<boolean, boolean>;
    error: import("vue").Ref<string | null, string | null>;
    isAuthenticated: import("vue").ComputedRef<boolean>;
    isAdmin: import("vue").ComputedRef<boolean>;
    isPowerUser: import("vue").ComputedRef<boolean>;
    isUser: import("vue").ComputedRef<boolean>;
    login: (email: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
    checkAuth: () => Promise<boolean>;
}, "login" | "logout" | "checkAuth">>;
//# sourceMappingURL=auth.d.ts.map