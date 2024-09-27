import type { xdr } from "@stellar/stellar-sdk";

export const lexicographicalSort = (arr: [number[], xdr.ScVal][]) => arr.sort(([a], [b]) => {
    const len = Math.min(a.length, b.length);
    
    for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) 
            return a[i] - b[i];
    }

    return a.length - b.length;
});