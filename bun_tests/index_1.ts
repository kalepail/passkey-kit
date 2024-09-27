import { xdr } from '@stellar/stellar-sdk';

const eventXDR = "AAAAAQAAAAAAAAABnUGtbB9pyBlyh+Q9MYjiiXLowBWO71Mz9WKbJ1z31ZgAAAABAAAAAAAAAAQAAAAPAAAABXN3X3YxAAAAAAAADwAAAANhZGQAAAAADQAAABR1uCpn7oY1jSi/pSfwW2e/YChYLgAAAA8AAAAEaW5pdAAAABAAAAABAAAAAgAAAA0AAABBBBs4FcABSsrQUBdm1u3Li1VPxppm2vqLR8EmaVdtlWI+WVvRnMesQxro9mTiF9Dn14HjKGlPjElWbR6beIsoVcYAAAAAAAAAAAAAAQ=="

const event = xdr.DiagnosticEvent.fromXDR(eventXDR, 'base64')

console.log(
    event.event().body().v0().data().toXDR().length
);
