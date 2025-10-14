"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RootRouteBinder = void 0;
class RootRouteBinder {
    constructor() {
        this.mounted = false;
    }
    bindRoot(app, handler) {
        if (this.mounted)
            return;
        app.get('/', (req, res) => handler.getRoot(req, res));
        this.mounted = true;
    }
}
exports.RootRouteBinder = RootRouteBinder;
//# sourceMappingURL=RootRouteBinder.js.map