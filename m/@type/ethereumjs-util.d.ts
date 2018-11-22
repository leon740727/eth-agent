declare module "ethereumjs-util" {
    export function pubToAddress (publicKey: Buffer): Buffer;
    export function privateToAddress (privateKey: Buffer): Buffer;
}
