import { config } from "dotenv";
import { run } from "./main";

config();

run().catch(console.error);
