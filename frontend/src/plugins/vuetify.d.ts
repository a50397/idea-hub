import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
declare const _default: {
    install: (app: import("vue").App<any>) => void;
    unmount: () => void;
    defaults: import("vue").Ref<import("vuetify").DefaultsInstance, import("vuetify").DefaultsInstance>;
    display: import("vuetify").DisplayInstance;
    theme: import("vuetify").ThemeInstance & {
        install: (app: import("vue").App<any>) => void;
    };
    icons: {
        defaultSet: string;
        aliases: Partial<import("vuetify").IconAliases>;
        sets: Record<string, import("vuetify").IconSet>;
    };
    locale: {
        name: string;
        decimalSeparator: import("vue").ShallowRef<string>;
        messages: import("vue").Ref<import("vuetify").LocaleMessages, import("vuetify").LocaleMessages>;
        current: import("vue").Ref<string, string>;
        fallback: import("vue").Ref<string, string>;
        t: (key: string, ...params: unknown[]) => string;
        n: (value: number) => string;
        provide: (props: import("vuetify").LocaleOptions) => import("vuetify").LocaleInstance;
        isRtl: import("vue").Ref<boolean, boolean>;
        rtl: import("vue").Ref<Record<string, boolean>, Record<string, boolean>>;
        rtlClasses: import("vue").Ref<string, string>;
    };
    date: {
        options: {
            adapter: (new (options: {
                locale: any;
                formats?: any;
            }) => import("vuetify").DateInstance) | import("vuetify").DateInstance;
            formats?: Record<string, any>;
            locale: Record<string, any>;
        };
        instance: {
            date: (value?: any) => unknown;
            format: (date: unknown, formatString: string) => string;
            toJsDate: (value: unknown) => Date;
            parseISO: (date: string) => unknown;
            toISO: (date: unknown) => string;
            startOfDay: (date: unknown) => unknown;
            endOfDay: (date: unknown) => unknown;
            startOfWeek: (date: unknown, firstDayOfWeek?: string | number | undefined) => unknown;
            endOfWeek: (date: unknown) => unknown;
            startOfMonth: (date: unknown) => unknown;
            endOfMonth: (date: unknown) => unknown;
            startOfYear: (date: unknown) => unknown;
            endOfYear: (date: unknown) => unknown;
            isAfter: (date: unknown, comparing: unknown) => boolean;
            isAfterDay: (date: unknown, comparing: unknown) => boolean;
            isSameDay: (date: unknown, comparing: unknown) => boolean;
            isSameMonth: (date: unknown, comparing: unknown) => boolean;
            isSameYear: (date: unknown, comparing: unknown) => boolean;
            isBefore: (date: unknown, comparing: unknown) => boolean;
            isEqual: (date: unknown, comparing: unknown) => boolean;
            isValid: (date: any) => boolean;
            isWithinRange: (date: unknown, range: [unknown, unknown]) => boolean;
            addMinutes: (date: unknown, amount: number) => unknown;
            addHours: (date: unknown, amount: number) => unknown;
            addDays: (date: unknown, amount: number) => unknown;
            addWeeks: (date: unknown, amount: number) => unknown;
            addMonths: (date: unknown, amount: number) => unknown;
            getYear: (date: unknown) => number;
            setYear: (date: unknown, year: number) => unknown;
            getDiff: (date: unknown, comparing: unknown, unit?: string | undefined) => number;
            getWeekArray: (date: unknown, firstDayOfWeek?: string | number | undefined) => unknown[][];
            getWeekdays: (firstDayOfWeek?: string | number | undefined, weekdayFormat?: "long" | "narrow" | "short" | undefined) => string[];
            getWeek: (date: unknown, firstDayOfWeek?: string | number | undefined, firstDayOfYear?: string | number | undefined) => number;
            getMonth: (date: unknown) => number;
            setMonth: (date: unknown, month: number) => unknown;
            getDate: (date: unknown) => number;
            setDate: (date: unknown, day: number) => unknown;
            getNextMonth: (date: unknown) => unknown;
            getPreviousMonth: (date: unknown) => unknown;
            getHours: (date: unknown) => number;
            setHours: (date: unknown, hours: number) => unknown;
            getMinutes: (date: unknown) => number;
            setMinutes: (date: unknown, minutes: number) => unknown;
            locale?: any;
        };
    };
    goTo: import("vuetify").GoToInstance;
};
export default _default;
//# sourceMappingURL=vuetify.d.ts.map