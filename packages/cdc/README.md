# @v5x/cdc

TypeScript port of the `vex-cdc` packet codec crate from `vex-v5-serial`.

```ts
import { SystemVersionPacket, decodeSystemVersionReply } from "@v5x/cdc";

const bytes = SystemVersionPacket.encode();
const reply = decodeSystemVersionReply(receivedBytes);
```
