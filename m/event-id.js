"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
function make(block, logIndex) {
    return block + ',' + logIndex;
}
exports.make = make;
function block(id) {
    const [block, logIndex] = id.split(',');
    return block;
}
exports.block = block;
function logIndex(id) {
    const [block, logIndex] = id.split(',');
    return parseInt(logIndex);
}
exports.logIndex = logIndex;
function isBefore(web3, eventId1, eventId2) {
    return __awaiter(this, void 0, void 0, function* () {
        function seq(eventId) {
            return __awaiter(this, void 0, void 0, function* () {
                const [blockHash, logIdx] = eventId.split(',');
                const block = yield web3.eth.getBlock(blockHash);
                return {
                    blk: block.number,
                    log: parseInt(logIdx),
                };
            });
        }
        const [a, b] = yield Promise.all([eventId1, eventId2].map(seq));
        if (a.blk < b.blk) {
            return true;
        }
        else if (a.blk > b.blk) {
            return false;
        }
        else {
            return a.log < b.log;
        }
    });
}
exports.isBefore = isBefore;
function isAfter(web3, eventId1, eventId2) {
    return isBefore(web3, eventId2, eventId1);
}
exports.isAfter = isAfter;
