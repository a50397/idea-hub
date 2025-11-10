"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusColors = exports.statusLabels = exports.effortLabels = exports.EventType = exports.Effort = exports.IdeaStatus = exports.Role = void 0;
var Role;
(function (Role) {
    Role["USER"] = "USER";
    Role["POWER_USER"] = "POWER_USER";
    Role["ADMIN"] = "ADMIN";
})(Role || (exports.Role = Role = {}));
var IdeaStatus;
(function (IdeaStatus) {
    IdeaStatus["SUBMITTED"] = "SUBMITTED";
    IdeaStatus["APPROVED"] = "APPROVED";
    IdeaStatus["IN_PROGRESS"] = "IN_PROGRESS";
    IdeaStatus["DONE"] = "DONE";
    IdeaStatus["REJECTED"] = "REJECTED";
})(IdeaStatus || (exports.IdeaStatus = IdeaStatus = {}));
var Effort;
(function (Effort) {
    Effort["LESS_THAN_ONE_DAY"] = "LESS_THAN_ONE_DAY";
    Effort["ONE_TO_THREE_DAYS"] = "ONE_TO_THREE_DAYS";
    Effort["MORE_THAN_THREE_DAYS"] = "MORE_THAN_THREE_DAYS";
})(Effort || (exports.Effort = Effort = {}));
var EventType;
(function (EventType) {
    EventType["SUBMITTED"] = "SUBMITTED";
    EventType["APPROVED"] = "APPROVED";
    EventType["REJECTED"] = "REJECTED";
    EventType["CLAIMED"] = "CLAIMED";
    EventType["STARTED"] = "STARTED";
    EventType["COMPLETED"] = "COMPLETED";
    EventType["UPDATED"] = "UPDATED";
    EventType["CHANGE_REQUESTED"] = "CHANGE_REQUESTED";
})(EventType || (exports.EventType = EventType = {}));
exports.effortLabels = {
    [Effort.LESS_THAN_ONE_DAY]: '< 1 day',
    [Effort.ONE_TO_THREE_DAYS]: '1-3 days',
    [Effort.MORE_THAN_THREE_DAYS]: '> 3 days',
};
exports.statusLabels = {
    [IdeaStatus.SUBMITTED]: 'Submitted',
    [IdeaStatus.APPROVED]: 'Approved',
    [IdeaStatus.IN_PROGRESS]: 'In Progress',
    [IdeaStatus.DONE]: 'Done',
    [IdeaStatus.REJECTED]: 'Rejected',
};
exports.statusColors = {
    [IdeaStatus.SUBMITTED]: 'info',
    [IdeaStatus.APPROVED]: 'success',
    [IdeaStatus.IN_PROGRESS]: 'warning',
    [IdeaStatus.DONE]: 'primary',
    [IdeaStatus.REJECTED]: 'error',
};
//# sourceMappingURL=index.js.map