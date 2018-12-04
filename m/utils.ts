export type EventListener <T> = (event: T) => void;

export function flatten <T> (itemsList: T[][]): T[] {
    return itemsList.reduce((acc, i) => acc.concat(i), []);
}
