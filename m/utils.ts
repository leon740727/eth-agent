import * as r from 'ramda';
import * as FakeTx from 'ethereumjs-tx/fake';

export type EventListener <T> = (event: T) => void;

export function flatten <T> (itemsList: T[][]): T[] {
    return itemsList.reduce((acc, i) => acc.concat(i), []);
}

export function wait (seconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
        setTimeout(() => resolve(seconds), second2time(seconds));
    });
}

export function waitFor (condition: () => boolean, interval: number): Promise<void> {
    if (condition()) {
        return Promise.resolve(undefined);
    } else {
        return wait(interval).then(_ => waitFor(condition, interval));
    }
}

export function second2time (second: number) {
    return second * 1000;
}

export function minute2time (minute: number) {
    return second2time(minute * 60);
}

export function hour2time (hour: number) {
    return minute2time(hour * 60);
}

export function day2time (day: number) {
    return hour2time(day * 24);
}

export function fakeTxHasher (tx): string {
    const data = r.pick(['to', 'data', 'value', 'nonce', 'gasPrice', 'gasLimit'], tx);
    return new FakeTx(data).hash(true).toString('hex');
}
