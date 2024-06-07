// Ported from https://github.com/golang/go/blob/26b5783b72376acd0386f78295e678b9a6bff30e/src/encoding/base64/base64.go#L53-L192
//
// Modifications:
//    * Removed logic supporting padding.
//    * Hardcoded the Base64 URL alphabet.
//    * Use a fixed length pre-allocated destination.
//    * Ported to Rust.
//
// Original Copyright notice:
//
// Copyright (c) 2009 The Go Authors. All rights reserved.
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google Inc. nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn encode(dst: &mut [u8], src: &[u8]) {
    let mut di: usize = 0;
    let mut si: usize = 0;
    let n = (src.len() / 3) * 3;

    while si < n {
        let val = (src[si] as usize) << 16 | (src[si + 1] as usize) << 8 | (src[si + 2] as usize);
        dst[di] = ALPHABET[val >> 18 & 0x3F];
        dst[di + 1] = ALPHABET[val >> 12 & 0x3F];
        dst[di + 2] = ALPHABET[val >> 6 & 0x3F];
        dst[di + 3] = ALPHABET[val & 0x3F];
        si += 3;
        di += 4;
    }

    let remain = src.len() - si;

    if remain == 0 {
        return;
    }

    let mut val = (src[si] as usize) << 16;

    if remain == 2 {
        val |= (src[si + 1] as usize) << 8;
    }

    dst[di] = ALPHABET[val >> 18 & 0x3F];
    dst[di + 1] = ALPHABET[val >> 12 & 0x3F];

    if remain == 2 {
        dst[di + 2] = ALPHABET[val >> 6 & 0x3F];
    }
}
