export type EventListener <T> = (event: T) => void;

export function flatten <T> (itemsList: T[][]): T[] {
    return itemsList.reduce((acc, i) => acc.concat(i), []);
}

export function wait (seconds: number): Promise<number> {
    return new Promise((resolve, reject) => {
        setTimeout(() => resolve(seconds), second2time(seconds));
    });
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
