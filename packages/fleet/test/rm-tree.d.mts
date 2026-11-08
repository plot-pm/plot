/** Removes a directory tree by its exact path, retrying while a child still writes into it. */
export declare const removeTree: (target: string, options?: { retries?: number; delayMs?: number }) => void;
