"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const r = require("ramda");
const FakeTx = require("ethereumjs-tx/fake");
function flatten(itemsList) {
    return itemsList.reduce((acc, i) => acc.concat(i), []);
}
exports.flatten = flatten;
function wait(seconds) {
    return new Promise((resolve, reject) => {
        setTimeout(() => resolve(seconds), second2time(seconds));
    });
}
exports.wait = wait;
function waitFor(condition, interval) {
    if (condition()) {
        return Promise.resolve(undefined);
    }
    else {
        return wait(interval).then(_ => waitFor(condition, interval));
    }
}
exports.waitFor = waitFor;
function second2time(second) {
    return second * 1000;
}
exports.second2time = second2time;
function minute2time(minute) {
    return second2time(minute * 60);
}
exports.minute2time = minute2time;
function hour2time(hour) {
    return minute2time(hour * 60);
}
exports.hour2time = hour2time;
function day2time(day) {
    return hour2time(day * 24);
}
exports.day2time = day2time;
function fakeTxHasher(tx) {
    const data = r.pick(['to', 'data', 'value', 'nonce', 'gasPrice', 'gasLimit'], tx);
    return new FakeTx(data).hash(true).toString('hex');
}
exports.fakeTxHasher = fakeTxHasher;
