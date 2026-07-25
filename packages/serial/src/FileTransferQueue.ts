import { TailQueue } from "./TailQueue.js";

/** Serializes operations that enter the device's file-transfer mode. */
export class FileTransferQueue extends TailQueue {}
