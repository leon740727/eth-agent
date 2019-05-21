import Web3 = require('web3');

export function make (block: string, logIndex: number) {
    return block + ',' + logIndex;
}

export function block (id: string): string {
    const [block, logIndex] = id.split(',');
    return block;
}

export function logIndex (id: string): number {
    const [block, logIndex] = id.split(',');
    return parseInt(logIndex);
}

export async function isBefore (web3: Web3, eventId1: string, eventId2: string) {
    async function seq (eventId: string): Promise<{blk: number, log: number}> {
        const [blockHash, logIdx] = eventId.split(',');
        const block = await web3.eth.getBlock(blockHash as any);
        return {
            blk: block.number,
            log: parseInt(logIdx),
        };
    }
    const [a, b] = await Promise.all([eventId1, eventId2].map(seq));
    if (a.blk < b.blk) {
        return true;
    } else if (a.blk > b.blk) {
        return false;
    } else {
        return a.log < b.log;
    }
}

export function isAfter (web3: Web3, eventId1: string, eventId2: string) {
    return isBefore(web3, eventId2, eventId1);
}
