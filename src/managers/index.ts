/**
 * Dependency-injected managers that compose the kit facade.
 */

export {
  CredentialManager,
  type CredentialManagerDeps,
} from "./credential-manager.js";
export { SignerManager, type SignerManagerDeps } from "./signer-manager.js";
export {
  SubmissionManager,
  type SubmissionManagerDeps,
} from "./submission-manager.js";
