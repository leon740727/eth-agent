"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function of(data) {
    return {
        error: null,
        data: data,
    };
}
exports.of = of;
function ofError(error) {
    return {
        error: error,
        data: null,
    };
}
exports.ofError = ofError;
