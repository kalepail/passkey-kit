"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.hasOwnProperty = hasOwnProperty;
// Check if the given object X has a field Y, and make that available to
// typescript typing.
function hasOwnProperty(obj, prop) {
  // eslint-disable-next-line no-prototype-builtins
  return obj.hasOwnProperty(prop);
}