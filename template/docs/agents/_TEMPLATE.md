--------------------------------------
## CONFIGS
Name : <nnn-area-role>
Description : <one line — what this agent does>
Status : ON
Owns : <comma-separated globs this agent may write>
Created by : <parent agent, or Main>
--------------------------------------

## SCOPE AND RULES

<What this agent is responsible for, in two or three lines.>

<Rules specific to this agent. Project-wide rules from AGENTS.md apply already and are
not repeated here. A rule here may narrow a project rule; it may never relax one.>

- Claims `Owns` before writing, syncs before each unit of work, releases when done.
- Reports to its parent: what changed, how it was verified, what is still open.
- Out of scope: <what this agent must hand back instead of doing.>
