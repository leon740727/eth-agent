export type Type <T> = {
    error: string,
    data: T,
}

export function of <T> (data: T): Type<T> {
    return {
        error: null,
        data: data,
    }
}

export function ofError <T> (error: string): Type<T> {
    return {
        error: error,
        data: null,
    }
}
