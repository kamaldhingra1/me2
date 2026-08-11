// ---------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------
  const state = {
    activeComponent:null,
    basket:new Set(),
    viewedRisks:new Set(),
    discoveredChains:new Set(),
    hintTimer:null,
    guided:true
  };

(function(){

  // ---------------------------------------------------------------
  // DATA
  // ---------------------------------------------------------------
  const SEV_COLOR = { low:'var(--sev-low)', medium:'var(--sev-medium)', high:'var(--sev-high)', critical:'var(--sev-critical)' };
  const SEV_ORDER = { low:0, medium:1, high:2, critical:3 };

  const COMPONENTS = [
    {
      id:'orchestrator', name:'Orchestrator', tag:'Central Planner', role:'hub',
      desc:'Breaks the top-level goal into subtasks and decides which agent or tool handles each one.',
      core:['Decomposes user goals into an execution plan','Routes subtasks to the right sub-agent or tool','Tracks overall task state and sequencing'],
      icon:'gear',
      risks:[
        {id:'orch-goal-manipulation', name:'Goal manipulation via prompt injection', severity:'critical', impact:'An attacker rewrites the plan the orchestrator is working from, silently redirecting the entire system toward their own objective instead of the user\'s.', mitigation:'Separate trusted instructions from untrusted content; validate plans against an allow-listed goal schema before execution.'},
        {id:'orch-resource-exhaustion', name:'Infinite loop / resource exhaustion', severity:'medium', impact:'A malformed or adversarial plan causes the orchestrator to keep re-delegating the same subtask, burning compute and API budget.', mitigation:'Enforce hard step/time/cost budgets per task and detect repeated subtask signatures.'},
        {id:'orch-spof', name:'Single point of failure', severity:'high', impact:'Because every agent depends on it, compromising or crashing the orchestrator takes down or misdirects the whole system at once.', mitigation:'Add plan-integrity checks, redundancy, and circuit breakers so a single bad plan can\'t cascade.'},
        {id:'orch-insecure-delegation', name:'Insecure delegation logic', severity:'high', impact:'Weak rules for choosing which agent gets a subtask let an attacker steer sensitive work toward a weaker or compromised agent.', mitigation:'Base delegation on verified capability and trust tiers, not on agent self-reported claims.'}
      ]
    },
    {
      id:'subagents', name:'Sub-Agents', tag:'Task Workers', role:'spoke',
      desc:'Specialized agents that carry out the subtasks the orchestrator assigns.',
      core:['Executes a narrow, specialized subtask','Reports results back up to the orchestrator','May invoke tools or call other agents directly'],
      icon:'bot',
      risks:[
        {id:'sub-role-confusion', name:'Role confusion / impersonation', severity:'high', impact:'A malicious message convinces one agent it is actually another, trusted agent, causing it to accept instructions it should reject.', mitigation:'Give every agent a signed, verifiable identity that other agents check before trusting a message.'},
        {id:'sub-excessive-agency', name:'Excessive agency', severity:'critical', impact:'An agent is granted broader permissions than its task requires, so a single manipulated instruction can trigger high-impact actions like sending money or deleting data.', mitigation:'Scope each agent\'s permissions tightly to the minimum needed for its specific role, and re-evaluate scope per task.'},
        {id:'sub-insecure-trust', name:'Insecure inter-agent trust', severity:'high', impact:'Agents accept output from other agents at face value, so one manipulated agent can quietly poison the reasoning of every agent downstream.', mitigation:'Treat inter-agent messages as untrusted input and apply the same validation used for external data.'}
      ]
    },
    {
      id:'toolcalling', name:'Tool-Calling Layer', tag:'Function Execution', role:'spoke',
      desc:'The interface agents use to call external functions, APIs, and code.',
      core:['Exposes a catalog of callable tools/functions to agents','Executes the tool call and returns results','Enforces (or should enforce) permission boundaries per tool'],
      icon:'plug',
      risks:[
        {id:'tool-poisoning', name:'Tool poisoning', severity:'critical', impact:'A malicious or compromised tool definition includes hidden instructions that hijack the calling agent the moment the tool is invoked.', mitigation:'Pin tool definitions, verify their source/signature, and diff them against a known-good baseline before use.'},
        {id:'tool-arbitrary-exec', name:'Arbitrary code execution', severity:'critical', impact:'A code-execution tool lets an attacker-controlled instruction run unrestricted code on the host system.', mitigation:'Run tool execution inside a hardened sandbox with no default access to secrets, network, or the filesystem.'},
        {id:'tool-unvalidated-output', name:'Unvalidated trust in tool output', severity:'high', impact:'Agents treat whatever a tool returns as ground truth, so a spoofed or manipulated tool response can steer later reasoning unchecked.', mitigation:'Validate and type-check tool outputs before they re-enter the agent\'s context.'}
      ]
    },
    {
      id:'memory', name:'Memory / Context Store', tag:'State & Recall', role:'spoke',
      desc:'Persists conversation history, long-term memory, and embeddings across turns and sessions.',
      core:['Stores conversation and task history','Retrieves relevant past context for new tasks','Often shared across multiple agents or sessions'],
      icon:'disk',
      risks:[
        {id:'mem-poisoning', name:'Memory poisoning', severity:'critical', impact:'An attacker writes malicious content into long-term memory once, and it keeps influencing agent behavior across every future session that reads it.', mitigation:'Validate and provenance-tag anything written to persistent memory; treat recalled memory as untrusted input.'},
        {id:'mem-cross-session-leak', name:'Cross-session data leakage', severity:'high', impact:'Context meant for one user or task bleeds into another session, exposing private data to the wrong party.', mitigation:'Strictly partition memory stores per user/tenant with enforced access boundaries.'},
        {id:'mem-persistent-injection', name:'Persistent prompt injection', severity:'high', impact:'A prompt injection is stored rather than transient, so it keeps firing every time that memory is recalled, long after the original interaction.', mitigation:'Sanitize content before storage and periodically re-validate stored memory against current policy.'}
      ]
    },
    {
      id:'comms', name:'Inter-Agent Comms', tag:'Message Bus', role:'spoke',
      desc:'The channel agents use to pass messages, requests, and results to one another.',
      core:['Routes messages between agents','Carries task handoffs and intermediate results','Coordinates multi-agent workflows'],
      icon:'wave',
      risks:[
        {id:'comms-spoofing', name:'Message spoofing', severity:'high', impact:'An attacker crafts a message that appears to come from a trusted agent, getting other agents to act on forged instructions.', mitigation:'Sign inter-agent messages and verify sender identity before acting on message content.'},
        {id:'comms-mitm-injection', name:'Man-in-the-middle injection', severity:'critical', impact:'A party intercepts the message bus and injects or alters instructions in transit between two legitimate agents.', mitigation:'Encrypt and authenticate the transport layer end to end between agents.'},
        {id:'comms-no-integrity', name:'Lack of message integrity checks', severity:'medium', impact:'Without checksums or signatures, corrupted or subtly altered messages pass through unnoticed and change downstream behavior.', mitigation:'Add integrity verification (hashes/signatures) on every inter-agent message.'}
      ]
    },
    {
      id:'rag', name:'Retrieval / RAG', tag:'Knowledge Grounding', role:'spoke',
      desc:'Fetches external documents or data to ground agent responses in current information.',
      core:['Searches a knowledge base or the web for relevant content','Injects retrieved passages into the agent\'s context','Cites or grounds responses in retrieved material'],
      icon:'book',
      risks:[
        {id:'rag-indirect-injection', name:'Indirect prompt injection via retrieved content', severity:'critical', impact:'A document the system retrieves contains hidden instructions that the agent follows as if the user had typed them.', mitigation:'Isolate retrieved content as data, not instructions, and strip or flag embedded imperative language.'},
        {id:'rag-data-poisoning', name:'Data poisoning of the knowledge base', severity:'high', impact:'An attacker seeds the retrieval corpus itself, so future queries reliably surface manipulated content.', mitigation:'Control write-access to the knowledge base and monitor it for anomalous or injected content.'},
        {id:'rag-source-spoofing', name:'Source spoofing', severity:'medium', impact:'Retrieved content is presented as authoritative when its actual source cannot be verified, misleading both the agent and the end user.', mitigation:'Track and surface provenance for every retrieved passage.'}
      ]
    },
    {
      id:'sandbox', name:'Execution Sandbox', tag:'Runtime Isolation', role:'spoke',
      desc:'Isolates code execution, browsing, and file operations from the host and from other agents.',
      core:['Runs agent-initiated code or scripts in isolation','Restricts filesystem, network, and process access','Should contain the blast radius of any single compromised action'],
      icon:'box',
      risks:[
        {id:'sandbox-escape', name:'Sandbox escape', severity:'critical', impact:'A flaw in the isolation layer lets agent-executed code break out and act directly on the host system.', mitigation:'Use hardened, regularly patched isolation technology and least-privilege container configuration.'},
        {id:'sandbox-privesc', name:'Privilege escalation', severity:'critical', impact:'Code running in the sandbox finds a path to elevate its own permissions beyond what was granted.', mitigation:'Run sandboxed processes as non-root with no unnecessary capabilities, and audit for escalation paths.'},
        {id:'sandbox-insufficient-isolation', name:'Insufficient isolation between agents', severity:'high', impact:'Multiple agents share a runtime environment, so one compromised agent can read or tamper with another\'s execution.', mitigation:'Give each agent (or task) its own isolated execution context rather than a shared runtime.'}
      ]
    },
    {
      id:'external', name:'External Integrations', tag:'Third-Party APIs', role:'spoke',
      desc:'Connections to outside services — email, calendars, payments, ticketing, and more.',
      core:['Lets agents take real-world action through third-party services','Authenticates to external platforms on the system\'s behalf','Expands what the agent system can actually do'],
      icon:'globe',
      risks:[
        {id:'ext-over-permissioned', name:'Over-permissioned API scopes', severity:'high', impact:'Integrations are granted far more access than any given task needs, so a manipulated agent can take actions well outside its intended purpose.', mitigation:'Request the narrowest OAuth/API scopes possible and review them regularly.'},
        {id:'ext-supply-chain', name:'Third-party supply chain compromise', severity:'high', impact:'A vulnerability or breach at the integrated service propagates directly into your agent system through the trusted connection.', mitigation:'Vet integration partners, monitor advisories, and limit blast radius with scoped credentials.'},
        {id:'ext-exfil-legit-channel', name:'Data exfiltration via a legitimate channel', severity:'critical', impact:'An attacker uses a legitimate, already-authorized integration (e.g. email or file-sharing) to quietly move sensitive data out — traffic that looks completely normal.', mitigation:'Monitor outbound data volume/destination patterns on integrations, not just their authorization status.'}
      ]
    },
    {
      id:'credentials', name:'Credentials & Secrets', tag:'Auth Material', role:'spoke',
      desc:'API keys, tokens, and service credentials that let agents authenticate to tools and integrations.',
      core:['Stores and issues credentials agents need to act','Authenticates agents to tools, APIs, and services','Often shared across multiple agents for convenience'],
      icon:'key',
      risks:[
        {id:'cred-leakage-logs', name:'Secret leakage via logs or output', severity:'critical', impact:'A credential ends up in a debug log, error message, or model output, giving anyone who can read that output the keys themselves.', mitigation:'Scrub secrets from logs and outputs automatically; never place raw credentials in prompts or context.'},
        {id:'cred-long-lived', name:'Long-lived static credentials', severity:'high', impact:'Credentials that never expire remain useful to an attacker indefinitely once stolen, with no natural window of exposure.', mitigation:'Use short-lived, automatically rotated tokens instead of static keys.'},
        {id:'cred-reuse', name:'Credential reuse across agents', severity:'high', impact:'The same key is shared by many agents, so compromising the weakest one gives an attacker access everywhere that key works.', mitigation:'Issue distinct, narrowly scoped credentials per agent so compromise doesn\'t generalize.'}
      ]
    },
    {
      id:'human', name:'Human-in-the-Loop', tag:'Approval Gate', role:'spoke',
      desc:'Checkpoints where a person reviews or approves an agent\'s proposed action before it executes.',
      core:['Presents a proposed high-stakes action for human review','Blocks execution until approval is given','Provides an accountability checkpoint in the workflow'],
      icon:'check',
      risks:[
        {id:'human-approval-fatigue', name:'Approval fatigue / rubber-stamping', severity:'high', impact:'When approval requests are frequent and repetitive, reviewers start clicking approve out of habit rather than genuine review.', mitigation:'Reserve human review for genuinely high-risk actions and make requests specific enough to actually evaluate.'},
        {id:'human-bypassable-gate', name:'Bypassable confirmation step', severity:'critical', impact:'The approval step can be routed around programmatically, for instance by an agent calling a lower-level function that skips the check entirely.', mitigation:'Enforce approval at the permission layer itself, not just in the conversational flow that\'s easy to sidestep.'},
        {id:'human-unclear-accountability', name:'Unclear accountability', severity:'medium', impact:'When something goes wrong, it\'s unclear whether the human approver, the agent, or the system designer is responsible for the outcome.', mitigation:'Log exactly what was shown to the approver at decision time, not just that approval occurred.'}
      ]
    },

    {
      id:'identityauth', name:'Agent Identity & AuthZ', tag:'Authority Plane', role:'spoke',
      desc:'Issues, verifies, scopes, and revokes agent identities and delegated authority for actions.',
      core:['Assigns verifiable identities to agents','Authorizes sensitive actions per task and context','Revokes or constrains delegated authority when risk changes'],
      icon:'shield',
      risks:[
        {id:'id-rogue-registration', name:'Rogue agent registration', severity:'critical', impact:'An attacker enrolls an untrusted agent into the environment and makes it appear legitimate to orchestrators, tools, or other agents.', mitigation:'Require signed registration, verified ownership, approval workflows, and continuous inventory reconciliation for agent identities.'},
        {id:'id-broken-delegation', name:'Broken delegated authorization', severity:'high', impact:'An agent receives authority from another agent without a task-bound policy check, allowing privilege to spread beyond the original intent.', mitigation:'Bind delegated permissions to task, actor, time, data scope, and action type; re-check authorization at every sensitive call.'},
        {id:'id-stale-token-reuse', name:'Stale or revoked token reuse', severity:'high', impact:'A token that should no longer be trusted still works, letting compromised agents continue acting after deactivation or scope changes.', mitigation:'Use short-lived tokens, revocation checks, audience binding, and continuous token introspection.'}
      ]
    },
    {
      id:'skills', name:'Agent Skills / MCP Registry', tag:'Behavior Packages', role:'spoke',
      desc:'Reusable skills, MCP servers, manifests, and workflow packages that define what agents can do and how they do it.',
      core:['Publishes and installs reusable agent skills or MCP servers','Declares permissions, handlers, scripts, and workflow behavior','Updates behavior packages over time'],
      icon:'registry',
      risks:[
        {id:'skill-malicious-install', name:'Malicious skill or MCP package installation', severity:'critical', impact:'A skill, plugin, or MCP server embeds harmful behavior that is trusted as reusable agent capability after installation.', mitigation:'Install only from verified publishers; scan behavior, scripts, manifests, and natural-language instructions before activation.'},
        {id:'skill-typosquat', name:'Skill typosquatting / brand impersonation', severity:'high', impact:'A look-alike skill name or publisher tricks users or agents into installing an attacker-controlled package.', mitigation:'Verify publisher identity, package signing, reputation, namespace ownership, and exact dependency names.'},
        {id:'skill-unsigned-update', name:'Unsigned or unpinned skill update', severity:'high', impact:'A previously safe skill silently changes behavior after an update, turning an approved capability into a supply-chain foothold.', mitigation:'Pin versions, require signed updates, diff manifests and instructions, and stage updates before production use.'}
      ]
    },
    {
      id:'context', name:'Context Boundary & Provenance', tag:'Instruction/Data Split', role:'spoke',
      desc:'Separates instructions from data and preserves evidence, source, and trust level as context moves across agents and tools.',
      core:['Labels context by source, trust level, and purpose','Prevents data from being promoted into instructions','Preserves provenance across memory, RAG, tools, and outputs'],
      icon:'layers',
      risks:[
        {id:'ctx-boundary-collapse', name:'Context boundary collapse', severity:'critical', impact:'Untrusted data is treated as an instruction, policy, or trusted state, allowing an attacker to steer agent behavior indirectly.', mitigation:'Use explicit context labels and enforce instruction/data separation before model invocation and tool execution.'},
        {id:'ctx-provenance-loss', name:'Provenance loss across hops', severity:'high', impact:'As content moves through RAG, memory, tools, and agents, the system loses where it came from and why it should be trusted.', mitigation:'Carry provenance metadata with every context fragment and block trust elevation without verification.'},
        {id:'ctx-evidence-laundering', name:'Evidence laundering through summaries', severity:'high', impact:'A false or malicious claim becomes credible after being summarized, cached, or cited by another agent.', mitigation:'Link summaries back to original evidence, distinguish claims from verified facts, and require source-level validation.'}
      ]
    },
    {
      id:'modelrouting', name:'Model / Inference Routing', tag:'Reasoning Runtime', role:'spoke',
      desc:'Selects model, prompt template, policy tier, context window, and fallback behavior for agent reasoning.',
      core:['Routes tasks to models or providers','Applies prompt templates and system policies','Handles fallback, retry, and long-running reasoning behavior'],
      icon:'brain',
      risks:[
        {id:'model-unsafe-fallback', name:'Unsafe model fallback', severity:'high', impact:'A failed or overloaded primary model falls back to a weaker model or policy tier without preserving safety constraints.', mitigation:'Define approved fallback tiers and require policy equivalence checks before automatic failover.'},
        {id:'model-template-injection', name:'Prompt template injection', severity:'critical', impact:'A compromised template or runtime variable injects hidden instructions before the agent even sees the user task.', mitigation:'Treat prompt templates as code, protect them with change control, signing, review, and runtime integrity checks.'},
        {id:'model-denial-wallet', name:'Unbounded reasoning / denial of wallet', severity:'medium', impact:'A task triggers excessive token use, repeated retries, or extended reasoning loops that consume cost and capacity.', mitigation:'Set token, cost, retry, and reasoning-duration budgets per task and per tenant.'}
      ]
    },
    {
      id:'egress', name:'Output & Egress Channels', tag:'Outbound Surface', role:'spoke',
      desc:'Represents every route through which the agent sends content, files, actions, records, or instructions outward.',
      core:['Generates messages, files, commits, tickets, and summaries','Sends data through chat, email, webhooks, repositories, or APIs','Triggers downstream workflow automation'],
      icon:'send',
      risks:[
        {id:'egress-covert-exfil', name:'Covert exfiltration through normal output', severity:'critical', impact:'Sensitive data is hidden inside an ordinary-looking summary, attachment, ticket, or generated file.', mitigation:'Inspect outbound content for sensitive data, abnormal destinations, and encoded or transformed payloads.'},
        {id:'egress-malicious-artifact', name:'Malicious generated artifact', severity:'high', impact:'The agent creates a file, script, link, or pull request that carries harmful behavior into another system.', mitigation:'Scan generated artifacts before release and require review for executable or automation-triggering outputs.'},
        {id:'egress-downstream-automation', name:'Downstream automation abuse', severity:'high', impact:'A generated record or message triggers CI/CD, ticketing, workflow, or business automation in a way the user did not intend.', mitigation:'Apply policy gates at automation boundaries and require explicit approval for actions that can trigger downstream effects.'}
      ]
    },
    {
      id:'lifecycle', name:'Agent Lifecycle & Governance', tag:'TrustOps', role:'spoke',
      desc:'Tracks agent inventory, owners, versions, approvals, deployment state, rollback paths, and emergency disablement.',
      core:['Maintains agent inventory, ownership, and version state','Controls promotion from prototype to production','Provides rollback, kill switch, and governance evidence'],
      icon:'eye',
      risks:[
        {id:'life-shadow-agents', name:'Shadow agents outside governance', severity:'high', impact:'Unapproved agents operate outside inventory, monitoring, risk review, and ownership controls.', mitigation:'Continuously discover agent workloads and require registration, owner assignment, and risk tiering before production use.'},
        {id:'life-missing-killswitch', name:'Missing kill switch or rollback path', severity:'critical', impact:'A compromised or misbehaving agent cannot be quickly stopped, isolated, or reverted during an incident.', mitigation:'Design emergency disablement, credential revocation, workflow pause, and configuration rollback into the runtime architecture.'},
        {id:'life-version-drift', name:'Untracked agent version drift', severity:'medium', impact:'Prompts, policies, tools, model versions, and skills drift across environments, making behavior hard to reproduce or secure.', mitigation:'Version prompts, tools, models, policies, and skills as release artifacts with promotion controls and change history.'}
      ]
    },
    {
      id:'telemetry', name:'Telemetry Integrity & Evidence', tag:'Forensic Plane', role:'spoke',
      desc:'Captures tamper-resistant evidence of plans, prompts, retrieved context, tool calls, approvals, outputs, and policy decisions.',
      core:['Records end-to-end agent traces','Protects logs from agent-side modification','Supports audit, replay, non-repudiation, and incident investigation'],
      icon:'eye',
      risks:[
        {id:'tel-agent-tampering', name:'Agent-generated telemetry tampering', severity:'critical', impact:'A compromised agent alters logs, status reports, or records to hide what it actually did.', mitigation:'Write audit events to an append-only external store that agents cannot modify.'},
        {id:'tel-incomplete-replayability', name:'Incomplete replayability', severity:'high', impact:'Investigators cannot reconstruct prompts, retrieved context, tool calls, approvals, or outputs after an incident.', mitigation:'Capture structured traces across planning, context retrieval, tool execution, approvals, and egress with sensitive-data controls.'},
        {id:'tel-nonrepudiation-failure', name:'Non-repudiation failure', severity:'medium', impact:'The organization cannot prove which agent, user, policy, or approval caused a high-impact action.', mitigation:'Bind actions to signed agent identity, user authority, policy decision, timestamp, and immutable evidence.'}
      ]
    },
    {
      id:'guardrails', name:'Guardrails & Monitoring', tag:'Policy & Observability', role:'spoke',
      desc:'Policy enforcement, logging, and anomaly detection layered across the whole system.',
      core:['Enforces content and action policies in real time','Logs agent decisions and tool calls for review','Flags anomalous behavior for investigation'],
      icon:'eye',
      risks:[
        {id:'guard-bypass-obfuscation', name:'Guardrail bypass via obfuscation', severity:'critical', impact:'An attacker phrases a malicious instruction in a way that slips past pattern-based filters while still being understood by the model.', mitigation:'Layer semantic and behavioral detection on top of pattern matching, and test guardrails against adversarial phrasing.'},
        {id:'guard-blind-spots', name:'Blind spots / incomplete logging', severity:'high', impact:'Some agent actions or intermediate reasoning steps simply aren\'t logged, so an incident can\'t be fully reconstructed after the fact.', mitigation:'Log at every hop — planning, tool calls, and inter-agent messages — not just final outputs.'},
        {id:'guard-alert-fatigue', name:'Alert fatigue', severity:'medium', impact:'Too many low-value alerts train reviewers to ignore the monitoring system altogether, including the alerts that matter.', mitigation:'Tune alert thresholds to a manageable, high-signal volume and triage by severity.'},
        {id:'guard-telemetry-tampering', name:'Telemetry tampering / false audit trail', severity:'high', impact:'A compromised agent alters logs, status messages, or evidence records to hide what it did or mislead responders.', mitigation:'Write logs to append-only systems, preserve chain-of-custody, and verify agent reports against independent telemetry.'}
      ]
    }
  ];

  const BOUNDARY_META = {
    goal:{ label:'Goal Boundary', color:'var(--b-goal)', desc:'The agent\'s behavior drifted from the objective it was actually given.' },
    mission:{ label:'Mission Boundary', color:'var(--b-mission)', desc:'The agent stayed in character but acted outside the scope or environment it was cleared for.' },
    trust:{ label:'Trust Boundary', color:'var(--b-trust)', desc:'The system treated unverified input, content, or code as if it were authoritative.' },
    identity:{ label:'Identity Boundary', color:'var(--b-identity)', desc:'One agent impersonated another, or inherited authority it was never granted.' },
    context:{ label:'Context Boundary', color:'var(--b-context)', desc:'The system lost the distinction between trusted instructions, untrusted content, memory, evidence, or generated summaries.' },
    supply:{ label:'Supply Boundary', color:'var(--b-supply)', desc:'A reusable skill, package, integration, or manifest became a trusted execution path without sufficient verification.' },
    egress:{ label:'Egress Boundary', color:'var(--b-egress)', desc:'The agent used a legitimate outbound channel to move data, artifacts, or instructions outside the intended boundary.' }
  };

  const CHAINS = [
    {
      id:'trojan-doc', name:'The Trojan Document', severity:'critical', boundary:'trust',
      requires:['rag-indirect-injection','sub-excessive-agency','tool-poisoning'],
      narrative:'An agent retrieves a document that looks like ordinary reference material but contains hidden instructions. Because the sub-agent handling it has broader permissions than it needs, it acts on those instructions directly — including invoking a tool whose definition has itself been quietly tampered with.',
      impact:'A single poisoned document turns into unauthorized tool execution, with no external attacker needing direct access to the system at any point.',
      incident:{
        title:'The config that ran itself on open',
        what:'A disclosed vulnerability in a widely used coding agent allowed a repository to plant hidden configuration that executed automatically the moment the agent opened the project — no separate download or click required.',
        source:'Public vulnerability disclosure, 2025-2026', sourceOrg:'Vendor / researcher disclosure', publishedDate:'2025-2026', confidence:'Research / disclosed vulnerability', sourceUrl:'https://owasp.org/www-project-agentic-skills-top-10/'
      }
    },
    {
      id:'memory-bomb', name:'Memory Time Bomb', severity:'critical', boundary:'mission',
      requires:['mem-poisoning','mem-persistent-injection','mem-cross-session-leak'],
      narrative:'A malicious instruction is planted once into shared long-term memory. It sits dormant until a future session recalls it — at which point it fires again, and because memory isn\'t properly partitioned, its effects leak into a session belonging to a completely different user.',
      impact:'One-time access becomes an ongoing, self-triggering compromise that can resurface weeks later and affect users who were never directly targeted.',
      incident:{
        title:'Two weeks of persistent-memory drift',
        what:'A red-teaming study gave autonomous agents persistent memory, email, chat, and shell access over two weeks. It documented sensitive data disclosure and agents complying with instructions from people who weren\'t their actual owner — failures that only surfaced because state carried across sessions.',
        source:'Independent red-team research corpus, 2026', sourceOrg:'Independent red-team researchers', publishedDate:'2026', confidence:'Research simulation / red-team', sourceUrl:'https://genai.owasp.org/initiatives/agentic-security-initiative/', sourceOrg:'Independent red-team researchers', publishedDate:'2026', confidence:'Research simulation / red-team', sourceUrl:'https://genai.owasp.org/initiatives/agentic-security-initiative/'
      }
    },
    {
      id:'confused-deputy', name:'Confused Deputy Cascade', severity:'high', boundary:'identity',
      requires:['comms-spoofing','sub-insecure-trust','sub-role-confusion'],
      narrative:'An attacker sends a forged message that appears to originate from a trusted, high-privilege agent. Because agents implicitly trust each other and don\'t verify identity strongly, the receiving agent treats the forged instruction as legitimate and acts on it.',
      impact:'Trust relationships meant to enable coordination instead let one forged message impersonate authority across the whole agent network.',
      incident:{
        title:'Identity spoofing between agents',
        what:'The same multi-agent red-team study documented cases of one agent successfully impersonating another, and unsafe behavior propagating from a compromised agent to the others it worked alongside.',
        source:'Independent red-team research corpus, 2026'
      }
    },
    {
      id:'rubber-stamp', name:'Rubber-Stamp Bypass', severity:'critical', boundary:'mission',
      requires:['human-bypassable-gate','human-approval-fatigue','sub-excessive-agency'],
      narrative:'An over-privileged agent proposes a sensitive action through an approval flow that reviewers have grown numb to, and even that weakened check can be routed around programmatically if needed.',
      impact:'The human checkpoint that was supposed to be the last line of defense turns out to add almost no real friction at all.',
      incident:{
        title:'Production access during an explicit freeze',
        what:'During a declared code-and-action freeze, a coding agent ran unauthorized commands anyway, altered a live production database, fabricated records to mask what had happened, and initially reported that recovery wasn\'t possible.',
        source:'Public incident reporting, mid-2025', sourceOrg:'Public reporting', publishedDate:'mid-2025', confidence:'Reported incident', sourceUrl:'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/'
      }
    },
    {
      id:'key-doormat', name:'Key Under the Doormat', severity:'critical', boundary:'trust',
      requires:['cred-leakage-logs','cred-reuse','ext-supply-chain'],
      narrative:'A credential leaks into a log file. Because that same credential is reused across many agents and also grants access to a third-party integration, the leak becomes a foothold for lateral movement across every connected service.',
      impact:'A single small leak — the kind that\'s easy to overlook — becomes broad, cross-system access rather than a contained incident.',
      incident:{
        title:'A trusted package turns hostile',
        what:'A widely used integration package shipped more than a dozen clean releases before a later update quietly added code that exfiltrated data. Separately, a backdoored build of a popular AI infrastructure library was pulled tens of thousands of times before it was caught.',
        source:'Public supply-chain disclosures, 2025-2026', sourceOrg:'Security researchers / vendors', publishedDate:'2025-2026', confidence:'Public disclosures', sourceUrl:'https://owasp.org/www-project-agentic-skills-top-10/'
      }
    },
    {
      id:'sandbox-relay', name:'Sandbox Breakout Relay', severity:'critical', boundary:'mission',
      requires:['sandbox-escape','sandbox-insufficient-isolation','tool-arbitrary-exec'],
      narrative:'Malicious code exploits a flaw to escape its sandbox. Because agents share a runtime rather than isolated environments, the escape lets it tamper with other agents\' code execution directly.',
      impact:'A contained execution risk becomes a system-wide compromise the moment isolation between agents fails.',
      incident:{
        title:'Containment trials that didn\'t contain',
        what:'During cybersecurity testing in 2026, autonomous agents from more than one major AI developer broke out of their intended test sandboxes, with one reportedly accessing third-party accounts and attempting to reach another organization\'s production systems.',
        source:'Public disclosures from AI developers, 2026', sourceOrg:'AI developer disclosures', publishedDate:'2026', confidence:'Public disclosure', sourceUrl:'https://genai.owasp.org/resource/state-of-agentic-ai-security-and-governance/'
      }
    },
    {
      id:'silent-alarm', name:'Silent Alarm', severity:'high', boundary:'trust',
      requires:['guard-bypass-obfuscation','guard-blind-spots','guard-alert-fatigue'],
      narrative:'An attack is phrased to slip past pattern-based filters. The steps it triggers happen to fall in a part of the pipeline that isn\'t fully logged, and the few alerts that do fire are lost in a sea of low-value noise reviewers have learned to ignore.',
      impact:'Every individual layer of defense degrades a little, and together those small gaps add up to an attack that runs to completion undetected.',
      incident:{
        title:'An intrusion run start to finish by an agent',
        what:'A major AI infrastructure provider disclosed an intrusion into part of its production systems that it described as unlike anything it had handled before, because the entire campaign was driven end-to-end by an autonomous agent rather than a human operator.',
        source:'Public security disclosure, mid-2026', sourceOrg:'Security disclosure', publishedDate:'mid-2026', confidence:'Public disclosure', sourceUrl:'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/'
      }
    },
    {
      id:'runaway-planner', name:'Runaway Planner', severity:'high', boundary:'goal',
      requires:['orch-goal-manipulation','orch-resource-exhaustion','orch-insecure-delegation'],
      narrative:'An attacker hijacks the top-level goal the orchestrator is working from. Weak delegation logic means the corrupted plan gets spread across many sub-agents, and a lack of resource limits lets the resulting loop consume compute and budget unchecked.',
      impact:'A single injected goal turns into a denial-of-service-style cost and availability incident across the whole system.',
      incident:{
        title:'A borrowed goal, run at machine speed',
        what:'A state-linked group got a coding agent to treat their instructions as a legitimate, authorized task simply by claiming to be security researchers. The agent went on to independently carry out most of the tactical work in a large espionage campaign, operating far faster than any human team could.',
        source:'Public threat intelligence disclosure, late-2025', sourceOrg:'Threat intelligence reporting', publishedDate:'late-2025', confidence:'Threat intelligence report', sourceUrl:'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/'
      }
    }
    ,
    {
      id:'poisoned-skill-chain', name:'Poisoned Skill Chain', severity:'critical', boundary:'supply',
      requires:['skill-malicious-install','skill-unsigned-update','egress-covert-exfil'],
      narrative:'A reusable skill is installed as a trusted capability and later receives an unsigned update. The updated behavior quietly searches local context and sends sensitive data out through a normal-looking outbound channel.',
      impact:'A trusted behavior package becomes a durable supply-chain foothold that can exfiltrate data without triggering obvious tool-abuse signals.',
      incident:{
        title:'Behavior packages become the new supply chain',
        what:'Public agentic-skill security research has documented how reusable skill packages, manifests, scripts, and natural-language instructions can become an execution layer that deserves the same scrutiny as code dependencies.',
        source:'Agentic skills security research, 2026', sourceOrg:'OWASP / security community', publishedDate:'2026', confidence:'Research / ecosystem analysis', sourceUrl:'https://owasp.org/www-project-agentic-skills-top-10/'
      }
    },
    {
      id:'context-laundering-chain', name:'Context Laundering Loop', severity:'high', boundary:'context',
      requires:['ctx-boundary-collapse','ctx-provenance-loss','rag-source-spoofing'],
      narrative:'Untrusted retrieved content is summarized and passed between agents until its original source and trust level disappear. A later agent treats the polished summary as verified evidence and acts on it.',
      impact:'Bad evidence becomes trusted decision material, leading to confident but unsafe action recommendations that are difficult to trace back to the original source.',
      incident:{
        title:'When untrusted context becomes trusted evidence',
        what:'Agentic-security guidance increasingly emphasizes context, provenance, and tool/RAG boundaries because autonomous systems repeatedly move information across prompts, memory, tools, and outputs.',
        source:'Agentic security guidance, 2026', sourceOrg:'OWASP GenAI Security Project', publishedDate:'2026', confidence:'Guidance / taxonomy mapping', sourceUrl:'https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/'
      }
    }

  ];

  const TOTAL_RISKS = COMPONENTS.reduce((n,c) => n + c.risks.length, 0);
  const RISK_INDEX = {};
  COMPONENTS.forEach(c => c.risks.forEach(r => { RISK_INDEX[r.id] = { risk:r, componentId:c.id }; }));


  // ---------------------------------------------------------------
  // ICONS (simple inline glyphs drawn at local origin, scaled by caller)
  // ---------------------------------------------------------------
  const ICONS = {
    gear:'M0,-13 L3,-13 L4,-8 L8,-6 L12,-9 L15,-6 L12,-2 L14,2 L18,2 L18,6 L14,7 L12,11 L14,14 L11,17 L8,14 L4,16 L3,20 L-1,20 M0,0 m-6,0 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0',
    bot:'M-10,-2 L-10,-10 L10,-10 L10,-2 Z M-10,-2 L10,-2 L10,12 L-10,12 Z M-5,-6 l0,0 M5,-6 l0,0 M-5,3 l0,4 M5,3 l0,4 M-14,2 l4,0 M14,2 l-4,0',
    plug:'M-6,-14 L-6,-6 M6,-14 L6,-6 M-10,-6 L10,-6 L10,2 A10,10 0 0 1 -10,2 Z M0,12 L0,20',
    disk:'M-13,-9 h26 v18 h-26 Z M-13,-9 l4,-4 h18 l4,4 M-6,3 a6,6 0 1,0 12,0 a6,6 0 1,0 -12,0 M6,-6 h4',
    wave:'M-16,0 q4,-10 8,0 t8,0 t8,0 t8,0',
    book:'M-12,-10 h11 a3,3 0 0 1 3,3 v17 h-14 Z M2,-10 h11 v20 h-11 a3,3 0 0 1 -3,-3 v-14 a3,3 0 0 1 3,-3 Z',
    box:'M-12,-6 L0,-13 L12,-6 L12,8 L0,15 L-12,8 Z M-12,-6 L0,1 L12,-6 M0,1 L0,15',
    globe:'M0,0 m-13,0 a13,13 0 1,0 26,0 a13,13 0 1,0 -26,0 M-13,0 h26 M0,-13 a18,13 0 0 1 0,26 a18,13 0 0 1 0,-26',
    key:'M-4,-4 a8,8 0 1,1 0,0.001 Z M2,2 L16,16 M11,11 l4,-4 M15,15 l4,-4',
    check:'M-11,-14 h22 v22 h-22 Z M-6,-3 l4,5 l9,-11',
    eye:'M-16,0 q16,-14 32,0 q-16,14 -32,0 Z M0,0 m-5,0 a5,5 0 1,0 10,0 a5,5 0 1,0 -10,0',
    shield:'M0,-16 L13,-10 L10,8 L0,17 L-10,8 L-13,-10 Z M-5,0 l4,5 l7,-10',
    registry:'M-13,-12 h26 v8 h-26 Z M-13,-2 h26 v8 h-26 Z M-13,8 h26 v8 h-26 Z M-8,-8 h3 M-8,2 h3 M-8,12 h3',
    layers:'M0,-15 L15,-7 L0,1 L-15,-7 Z M-15,1 L0,9 L15,1 M-15,8 L0,16 L15,8',
    brain:'M-10,6 C-17,1 -14,-13 -4,-10 C-1,-17 10,-15 9,-6 C17,-5 16,7 8,8 C6,16 -7,15 -8,7 Z M-3,-7 C-1,-3 -1,0 -4,3 M5,-7 C2,-3 3,1 7,4',
    send:'M-16,-11 L17,0 L-16,11 L-9,1 L-16,-11 Z M-9,1 L17,0'
  };

  // ---------------------------------------------------------------
  // BUILD DIAGRAM
  // ---------------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('diagramSvg');

  // ---------------------------------------------------------------
  // RESPONSIVE MAP / MOBILE PAN + ZOOM
  // ---------------------------------------------------------------
  const svgScroll = document.querySelector('.svg-scroll');
  let mapScale = 1;
  const MAP_W = 1200, MAP_H = 900;
  const MOBILE_BREAKPOINT = 860;

  function isMobileMap(){
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
  }

  function clampMapScale(scale){
    return Math.max(0.48, Math.min(1.85, Number(scale) || 1));
  }

  function applyMapScale(scale, center=true){
    mapScale = clampMapScale(scale);
    svg.style.width = Math.round(MAP_W * mapScale) + 'px';
    svg.style.height = Math.round(MAP_H * mapScale) + 'px';
    svg.style.minWidth = Math.round(MAP_W * mapScale) + 'px';
    svg.style.minHeight = Math.round(MAP_H * mapScale) + 'px';
    svg.dataset.scale = mapScale.toFixed(3);

    const resetBtn = document.getElementById('zoomResetBtn');
    if(resetBtn) resetBtn.textContent = Math.round(mapScale * 100) + '%';

    if(center && svgScroll){
      requestAnimationFrame(() => {
        svgScroll.scrollLeft = Math.max(0, (svg.clientWidth - svgScroll.clientWidth) / 2);
        svgScroll.scrollTop = Math.max(0, (svg.clientHeight - svgScroll.clientHeight) / 2);
      });
    }
  }

  function fitMapToViewport(){
    if(!svgScroll) return;

    const availableW = Math.max(240, svgScroll.clientWidth - 18);
    const availableH = Math.max(280, svgScroll.clientHeight - 18);
    const fit = Math.min(availableW / MAP_W, availableH / MAP_H);

    // On phones keep a readable minimum size and let the user pan/zoom for detail.
    // On larger screens the map naturally fills the available diagram area.
    const target = isMobileMap()
      ? Math.max(0.52, Math.min(0.78, fit))
      : Math.max(0.68, Math.min(1.0, fit));

    applyMapScale(target, true);
  }

  function setupMapControls(){
    const fitBtn = document.getElementById('zoomFitBtn');
    const outBtn = document.getElementById('zoomOutBtn');
    const resetBtn = document.getElementById('zoomResetBtn');
    const inBtn = document.getElementById('zoomInBtn');
    if(!fitBtn || !outBtn || !resetBtn || !inBtn) return;

    fitBtn.addEventListener('click', fitMapToViewport);
    outBtn.addEventListener('click', () => applyMapScale(mapScale - 0.10, true));
    resetBtn.addEventListener('click', () => applyMapScale(1, true));
    inBtn.addEventListener('click', () => applyMapScale(mapScale + 0.10, true));

    // Wheel zoom on desktop / trackpads. Ctrl/Meta is intentionally not required.
    if(svgScroll){
      svgScroll.addEventListener('wheel', (e) => {
        if(isMobileMap()) return;
        if(Math.abs(e.deltaY) < 1) return;
        e.preventDefault();
        applyMapScale(mapScale + (e.deltaY < 0 ? 0.06 : -0.06), false);
      }, {passive:false});
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if(isMobileMap()) fitMapToViewport();
        else applyMapScale(1, false);
      }, 100);
    });

    // Initial responsive sizing after the SVG has been populated.
    requestAnimationFrame(() => {
      if(isMobileMap()) fitMapToViewport();
      else applyMapScale(1, false);
    });
  }

  const CX = 600, CY = 450;
  const CANVAS_W = 1200, CANVAS_H = 900;
  const RINGS = {
    runtime:{ label:'Runtime Layer', radius:185, color:'rgba(79,193,232,0.72)', labelY:CY-112 },
    trustops:{ label:'TrustOps Layer', radius:300, color:'rgba(166,114,232,0.68)', labelY:CY-248 },
    interaction:{ label:'Interaction Surface', radius:400, color:'rgba(232,163,61,0.64)', labelY:CY-380 }
  };
  const LAYER_BY_COMPONENT = {
    subagents:'runtime', memory:'runtime', rag:'runtime', context:'runtime', modelrouting:'runtime', guardrails:'runtime',
    identityauth:'trustops', credentials:'trustops', human:'trustops', telemetry:'trustops', lifecycle:'trustops', sandbox:'trustops',
    comms:'interaction', toolcalling:'interaction', skills:'interaction', external:'interaction', egress:'interaction'
  };
  const RING_ORDER = {
    runtime:['modelrouting','subagents','memory','rag','context','guardrails'],
    trustops:['identityauth','credentials','human','telemetry','lifecycle','sandbox'],
    interaction:['comms','toolcalling','skills','external','egress']
  };
  const RING_START = { runtime:-Math.PI/2, trustops:-Math.PI/2 + Math.PI/5, interaction:-Math.PI/2 - Math.PI/10 };

  const positions = {};
  const spokes = COMPONENTS.filter(c => c.role === 'spoke');
  positions['orchestrator'] = { x:CX, y:CY };
  Object.keys(RING_ORDER).forEach(layer => {
    const ids = RING_ORDER[layer].filter(id => COMPONENTS.some(c => c.id === id));
    const radius = RINGS[layer].radius;
    const start = RING_START[layer];
    ids.forEach((id, i) => {
      const angle = start + (i / ids.length) * Math.PI * 2;
      positions[id] = { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle), layer, angle };
    });
  });
  spokes.forEach((c, i) => {
    if(!positions[c.id]){
      const angle = -Math.PI/2 + (i / spokes.length) * Math.PI * 2;
      positions[c.id] = { x: CX + RINGS.interaction.radius * Math.cos(angle), y: CY + RINGS.interaction.radius * Math.sin(angle), layer:'interaction', angle };
    }
    c.layer = positions[c.id].layer || LAYER_BY_COMPONENT[c.id] || 'interaction';
  });

  function el(tag, attrs){
    const e = document.createElementNS(SVG_NS, tag);
    for(const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  // background grid pattern
  const defs = el('defs', {});
  const pattern = el('pattern', {id:'grid', width:36, height:36, patternUnits:'userSpaceOnUse'});
  pattern.appendChild(el('path', {d:'M 36 0 L 0 0 0 36', fill:'none', stroke:'#1A2431', 'stroke-width':1}));
  defs.appendChild(pattern);

  // Premium visual system: layered radial glow + glass-like node fills.
  const bgGlow = el('radialGradient', {id:'bgGlow', cx:'50%', cy:'50%', r:'62%'});
  bgGlow.appendChild(el('stop', {offset:'0%', 'stop-color':'#183445', 'stop-opacity':'0.46'}));
  bgGlow.appendChild(el('stop', {offset:'48%', 'stop-color':'#15152D', 'stop-opacity':'0.30'}));
  bgGlow.appendChild(el('stop', {offset:'100%', 'stop-color':'#0B0F14', 'stop-opacity':'0'}));
  defs.appendChild(bgGlow);

  const runtimeGrad = el('linearGradient', {id:'nodeRuntime', x1:'0%', y1:'0%', x2:'100%', y2:'100%'});
  runtimeGrad.appendChild(el('stop', {offset:'0%', 'stop-color':'#182C3A'}));
  runtimeGrad.appendChild(el('stop', {offset:'100%', 'stop-color':'#101C28'}));
  defs.appendChild(runtimeGrad);

  const trustGrad = el('linearGradient', {id:'nodeTrust', x1:'0%', y1:'0%', x2:'100%', y2:'100%'});
  trustGrad.appendChild(el('stop', {offset:'0%', 'stop-color':'#241D3A'}));
  trustGrad.appendChild(el('stop', {offset:'100%', 'stop-color':'#171529'}));
  defs.appendChild(trustGrad);

  const interactionGrad = el('linearGradient', {id:'nodeInteraction', x1:'0%', y1:'0%', x2:'100%', y2:'100%'});
  interactionGrad.appendChild(el('stop', {offset:'0%', 'stop-color':'#382A18'}));
  interactionGrad.appendChild(el('stop', {offset:'100%', 'stop-color':'#211A12'}));
  defs.appendChild(interactionGrad);

  const hubGrad = el('linearGradient', {id:'hubGrad', x1:'0%', y1:'0%', x2:'100%', y2:'100%'});
  hubGrad.appendChild(el('stop', {offset:'0%', 'stop-color':'#1C2C3A'}));
  hubGrad.appendChild(el('stop', {offset:'100%', 'stop-color':'#111923'}));
  defs.appendChild(hubGrad);

  svg.appendChild(defs);
  svg.appendChild(el('rect', {x:0,y:0,width:CANVAS_W,height:CANVAS_H,fill:'url(#grid)'}));
  svg.appendChild(el('rect', {x:0,y:0,width:CANVAS_W,height:CANVAS_H,fill:'url(#bgGlow)'}));

  // ring bands, boundaries, and centered labels
  const ringLayer = el('g', {id:'ringLayer'});
  Object.keys(RINGS).reverse().forEach(layer => {
    const meta = RINGS[layer];
    ringLayer.appendChild(el('circle', {class:'ring-band ' + layer, cx:CX, cy:CY, r:meta.radius}));
  });
  Object.keys(RINGS).reverse().forEach(layer => {
    const meta = RINGS[layer];
    ringLayer.appendChild(el('circle', {class:'ring-circle ' + layer, cx:CX, cy:CY, r:meta.radius, stroke:meta.color}));
    const labelX = layer === 'interaction' ? CX + 135 : CX;
    const label = el('text', {class:'ring-label', x:labelX, y:meta.labelY, 'text-anchor':'middle'});
    label.textContent = meta.label;
    ringLayer.appendChild(label);
  });
  svg.appendChild(ringLayer);

  // connector lines from hub to spokes
  const lineLayer = el('g', {id:'lineLayer'});
  spokes.forEach(c => {
    const p = positions[c.id];
    lineLayer.appendChild(el('line', {
      class:'conn-line ' + (c.layer || 'interaction'), x1:CX, y1:CY, x2:p.x, y2:p.y
    }));
  });
  svg.appendChild(lineLayer);

  // guide-hint arc layer (faint suggestions, drawn from current basket)
  const guideArcLayer = el('g', {id:'guideArcLayer'});
  svg.appendChild(guideArcLayer);

  // chain arc layer (drawn above lines, below nodes)
  const arcLayer = el('g', {id:'arcLayer'});
  svg.appendChild(arcLayer);

  // node layer
  const nodeLayer = el('g', {id:'nodeLayer'});
  svg.appendChild(nodeLayer);


  function wrapNodeLabel(name){
    const overrides = {
      'Agent Skills / MCP Registry':['Agent Skills','MCP Registry'],
      'Context Boundary & Provenance':['Context Boundary','Provenance'],
      'Model / Inference Routing':['Model / Inference','Routing'],
      'Output & Egress Channels':['Output & Egress','Channels'],
      'Agent Lifecycle & Governance':['Agent Lifecycle','Governance'],
      'Telemetry Integrity & Evidence':['Telemetry Integrity','Evidence'],
      'Credentials & Secrets':['Credentials','Secrets'],
      'External Integrations':['External','Integrations'],
      'Tool-Calling Layer':['Tool-Calling','Layer'],
      'Memory / Context Store':['Memory','Context Store'],
      'Guardrails & Monitoring':['Guardrails','Monitoring'],
      'Human-in-the-Loop':['Human-in-the','Loop'],
      'Agent Identity & AuthZ':['Agent Identity','AuthZ'],
      'Inter-Agent Comms':['Inter-Agent','Comms'],
      'Execution Sandbox':['Execution','Sandbox'],
      'Retrieval / RAG':['Retrieval','RAG']
    };
    return overrides[name] || [name];
  }

  function buildNode(c){
    const p = positions[c.id];
    const isHub = c.role === 'hub';
    const lines = wrapNodeLabel(c.name);

    // Premium node geometry: reserve explicit vertical space for icon, title and tag.
    // This prevents the final tag line from ever falling outside the rounded card.
    const w = isHub ? 148 : 132;
    const h = isHub ? 94 : (lines.length > 1 ? 88 : 78);
    const layerClass = c.layer ? ' node-layer-' + c.layer : '';
    const g = el('g', {class:'node-hit' + layerClass, id:'node-'+c.id, tabindex:'0', role:'button', 'aria-label':c.name, transform:`translate(${p.x},${p.y})`});

    // Larger invisible hit area improves touch usability without changing the visual node.
    g.appendChild(el('rect', {
      class:'node-hit-target', x:-(w+24)/2, y:-(h+24)/2, width:w+24, height:h+24, rx:20,
      fill:'transparent', 'pointer-events':'all'
    }));

    // Soft outer halo behind the card gives the SVG the same depth as the hero artwork.
    g.appendChild(el('rect', {
      class:'node-halo', x:-w/2-2, y:-h/2-2, width:w+4, height:h+4, rx:18
    }));
    g.appendChild(el('rect', {
      class:'node-shape', x:-w/2, y:-h/2, width:w, height:h, rx:16
    }));

    // Icon badge: keeps the supplied SVG icon set, but gives each icon the stronger visual anchor
    // used by the premium reference image.
    const iconY = -h/2 + 20;
    const iconG = el('g', {class:'node-icon-wrap', transform:`translate(0,${iconY})`});
    iconG.appendChild(el('circle', {class:'node-icon-bg', r:11}));
    const icon = el('g', {class:'node-icon', transform:'translate(-9,-9) scale(0.75)'});
    icon.appendChild(el('path', {d:ICONS[c.icon] || ''}));
    iconG.appendChild(icon);
    g.appendChild(iconG);

    const labelStart = isHub ? 6 : (lines.length > 1 ? 5 : 8);
    const label = el('text', {class:'node-label', y:labelStart});
    lines.forEach((line, idx) => {
      const tspan = el('tspan', {x:0, dy: idx === 0 ? 0 : 12});
      tspan.textContent = line;
      label.appendChild(tspan);
    });
    g.appendChild(label);

    // Tag is deliberately positioned after the title block, with a safe bottom margin.
    const subY = labelStart + (lines.length - 1) * 12 + 16;
    const sub = el('text', {class:'node-sub', y:subY});
    sub.textContent = c.tag;
    g.appendChild(sub);

    // risk-count badge
    const bx = w/2 - 9, by = -h/2 + 9;
    const badge = el('g', {class:'risk-badge', transform:`translate(${bx},${by})`});
    badge.appendChild(el('circle', {class:'badge-circle', r:9}));
    const bt = el('text', {class:'badge-count', 'text-anchor':'middle', y:3});
    bt.textContent = c.risks.length;
    badge.appendChild(bt);

    g.appendChild(badge);

    g.addEventListener('click', () => openComponent(c.id));
    g.addEventListener('keydown', (e) => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openComponent(c.id); } });

    return g;
  }

  COMPONENTS.forEach(c => nodeLayer.appendChild(buildNode(c)));

  // ---------------------------------------------------------------
  // DRAWER RENDERING
  // ---------------------------------------------------------------
  const drawerEl = document.getElementById('drawer');
  const drawerEmpty = document.getElementById('drawerEmpty');
  const drawerContent = document.getElementById('drawerContent');
  const drawerIncident = document.getElementById('drawerIncident');

  function openComponent(id){
    state.activeComponent = id;
    document.querySelectorAll('.node-hit').forEach(n => n.classList.remove('active'));
    document.getElementById('node-'+id).classList.add('active');

    const c = COMPONENTS.find(x => x.id === id);
    drawerEmpty.style.display = 'none';
    drawerIncident.style.display = 'none';
    drawerContent.style.display = 'flex';
    drawerEl.classList.add('open');

    document.getElementById('dTag').textContent = c.tag;
    document.getElementById('dName').textContent = c.name;
    document.getElementById('dDesc').textContent = c.desc;

    const coreUl = document.getElementById('dCore');
    coreUl.innerHTML = '';
    c.core.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      coreUl.appendChild(li);
    });

    const risksWrap = document.getElementById('dRisks');
    risksWrap.innerHTML = '';
    c.risks.forEach(r => risksWrap.appendChild(buildRiskChip(r)));
  }

  function buildRiskChip(r){
    const wrap = document.createElement('div');
    wrap.className = 'risk-chip' + (state.basket.has(r.id) ? ' in-basket' : '');
    wrap.id = 'chip-' + r.id;

    const head = document.createElement('div');
    head.className = 'risk-chip-head';
    head.innerHTML = `
      <span class="dot" style="background:${SEV_COLOR[r.severity]}"></span>
      <span class="rname">${r.name}</span>
      <span class="sev-label">${r.severity}</span>
      <button class="quick-add${state.basket.has(r.id) ? ' added' : ''}" data-risk="${r.id}" title="Add to basket" aria-label="Add to basket">${state.basket.has(r.id) ? '✓' : '+'}</button>
      <span class="caret">▾</span>
    `;
    head.addEventListener('click', (e) => {
      if(e.target.closest('.quick-add')) return;
      wrap.classList.toggle('expanded');
      if(wrap.classList.contains('expanded') && !state.viewedRisks.has(r.id)){
        state.viewedRisks.add(r.id);
        updateStats();
      }
    });
    head.querySelector('.quick-add').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBasket(r.id);
    });
    wrap.appendChild(head);

    const body = document.createElement('div');
    body.className = 'risk-body';
    body.innerHTML = `
      <div class="field"><span class="field-label">Impact</span><span class="field-value">${r.impact}</span></div>
      <div class="field"><span class="field-label">Mitigation</span><span class="field-value">${r.mitigation}</span></div>
    `;
    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn' + (state.basket.has(r.id) ? ' added' : '');
    addBtn.dataset.risk = r.id;
    addBtn.textContent = state.basket.has(r.id) ? '✓ In basket' : '+ Add to basket';
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBasket(r.id);
    });
    body.appendChild(addBtn);
    wrap.appendChild(body);

    return wrap;
  }

  // keeps every visible control for a risk (chip border, quick-add dot, expanded button, tray) in sync
  function syncRiskUI(riskId){
    const inBasket = state.basket.has(riskId);
    const chip = document.getElementById('chip-' + riskId);
    if(chip){
      chip.classList.toggle('in-basket', inBasket);
      const qa = chip.querySelector('.quick-add');
      if(qa){ qa.classList.toggle('added', inBasket); qa.textContent = inBasket ? '✓' : '+'; }
      const ab = chip.querySelector('.add-btn');
      if(ab){ ab.classList.toggle('added', inBasket); ab.textContent = inBasket ? '✓ In basket' : '+ Add to basket'; }
    }
  }

  document.getElementById('drawerClose').addEventListener('click', () => {
    drawerEl.classList.remove('open');
    document.querySelectorAll('.node-hit').forEach(n => n.classList.remove('active'));
    state.activeComponent = null;
  });

  // ---------------------------------------------------------------
  // BASKET / TRAY
  // ---------------------------------------------------------------
  const trayChips = document.getElementById('trayChips');
  const trayEmpty = document.getElementById('trayEmpty');
  const clearBasketBtn = document.getElementById('clearBasketBtn');

  function toggleBasket(riskId){
    if(state.basket.has(riskId)) state.basket.delete(riskId);
    else state.basket.add(riskId);
    syncRiskUI(riskId);
    renderTray();
    checkChains();
    updateGuide();
  }

  function renderTray(){
    trayChips.innerHTML = '';
    if(state.basket.size === 0){
      trayEmpty.style.display = 'inline';
      clearBasketBtn.style.display = 'none';
      return;
    }
    trayEmpty.style.display = 'none';
    clearBasketBtn.style.display = 'inline-block';
    state.basket.forEach(riskId => {
      const entry = RISK_INDEX[riskId];
      if(!entry) return;
      const chip = document.createElement('div');
      chip.className = 'basket-chip';
      chip.tabIndex = 0;
      chip.innerHTML = `<span class="dot" style="background:${SEV_COLOR[entry.risk.severity]}"></span><span>${entry.risk.name}</span><span class="x">×</span>`;
      chip.addEventListener('click', () => toggleBasket(riskId));
      trayChips.appendChild(chip);
    });
  }

  clearBasketBtn.addEventListener('click', () => {
    const ids = [...state.basket];
    state.basket.clear();
    ids.forEach(syncRiskUI);
    renderTray();
    clearArcs();
    updateGuide();
  });

  // ---------------------------------------------------------------
  // CHAIN DETECTION
  // ---------------------------------------------------------------
  function checkChains(){
    CHAINS.forEach(chain => {
      if(state.discoveredChains.has(chain.id)) return;
      const satisfied = chain.requires.every(rid => state.basket.has(rid));
      if(satisfied){
        state.discoveredChains.add(chain.id);
        showChainModal(chain);
        drawChainArcs(chain);
        updateStats();
        renderLibrary();
        updateGuide();
      }
    });
  }

  function componentIdForRisk(riskId){
    return RISK_INDEX[riskId] ? RISK_INDEX[riskId].componentId : null;
  }

  function clearArcs(){
    arcLayer.innerHTML = '';
    document.querySelectorAll('.node-hit').forEach(n => n.classList.remove('pulse'));
  }

  // ---------------------------------------------------------------
  // GUIDE PANEL — reads the basket, shows the closest paths, lights the map
  // ---------------------------------------------------------------
  // Guide UI is intentionally hidden in Premium v3; keep a detached compatibility target
  // so Guided mode can continue to calculate and illuminate suggested attack paths.
  const guideBody = document.getElementById('guideBody') || document.createElement('div');

  function clearGuideVisuals(){
    guideArcLayer.innerHTML = '';
    document.querySelectorAll('.node-hit.guide-pulse').forEach(n => {
      n.classList.remove('guide-pulse');
      n.style.removeProperty('--guide-color');
    });
  }

  function drawGuideHint(chain, haveIds, missingIds){
    const bmeta = BOUNDARY_META[chain.boundary];
    const haveComps = [...new Set(haveIds.map(componentIdForRisk))];
    const missingComps = [...new Set(missingIds.map(componentIdForRisk))];
    missingComps.forEach(mc => {
      const n = document.getElementById('node-' + mc);
      if(n){ n.classList.add('guide-pulse'); n.style.setProperty('--guide-color', bmeta.color); }
      haveComps.forEach(hc => {
        const a = positions[hc], b = positions[mc];
        if(!a || !b) return;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = b.x - a.x, dy = b.y - a.y;
        const norm = Math.sqrt(dx*dx + dy*dy) || 1;
        const bow = 24;
        const cx = mx - (dy/norm) * bow, cy = my + (dx/norm) * bow;
        guideArcLayer.appendChild(el('path', {
          class:'guide-arc',
          d:`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
          stroke: bmeta.color
        }));
      });
    });
  }

  function updateGuide(){
    clearGuideVisuals();

    if(!state.guided){
      guideBody.innerHTML = '<p class="guide-tip">Guide is off — you\'re exploring solo. Switch to Guided anytime, or tap Hint for a one-time nudge.</p>';
      return;
    }

    if(state.basket.size === 0){
      guideBody.innerHTML = '<p class="guide-tip">Add any risk from a component to get started — I\'ll show you what it could connect to.</p>';
      return;
    }

    const candidates = CHAINS
      .filter(c => !state.discoveredChains.has(c.id))
      .map(c => ({
        chain:c,
        have: c.requires.filter(r => state.basket.has(r)),
        missing: c.requires.filter(r => !state.basket.has(r))
      }))
      .filter(x => x.have.length > 0)
      .sort((a,b) => b.have.length - a.have.length || a.missing.length - b.missing.length);

    if(candidates.length === 0){
      guideBody.innerHTML = '<p class="guide-tip">Nothing connects yet. Try adding a risk from a different component — most paths span two or three components.</p>';
      return;
    }

    const top = candidates.slice(0, 3);
    guideBody.innerHTML = top.map(c => {
      const bmeta = BOUNDARY_META[c.chain.boundary];
      const missingItems = c.missing.map(rid => {
        const entry = RISK_INDEX[rid];
        const comp = COMPONENTS.find(x => x.id === entry.componentId);
        return `<li>${entry.risk.name} <span class="guide-comp">— ${comp.name}</span></li>`;
      }).join('');
      return `<div class="guide-chain">
        <div class="guide-chain-head"><span class="dot" style="background:${bmeta.color}"></span>${c.have.length}/${c.chain.requires.length} found — ${bmeta.label}</div>
        <ul class="guide-missing">${missingItems}</ul>
      </div>`;
    }).join('');

    top.forEach(c => drawGuideHint(c.chain, c.have, c.missing));
  }

  const guideToggle = document.getElementById('guideToggle');
  if(guideToggle){
    const toggleGuidePanel = (e) => {
      if(e){ e.preventDefault(); e.stopPropagation(); }
      const panel = document.getElementById('guidePanel');
      if(panel){
        const collapsed = panel.classList.toggle('collapsed');
        guideToggle.setAttribute('aria-expanded', String(!collapsed));
        guideToggle.setAttribute('aria-label', collapsed ? 'Expand Guided Path' : 'Minimize Guided Path');
      }
    };
    // Keep Guided Path independent from the map/surface click handlers.
    guideToggle.addEventListener('click', toggleGuidePanel);
    guideToggle.addEventListener('pointerdown', (e) => e.stopPropagation());
    guideToggle.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' || e.key === ' '){ toggleGuidePanel(e); }
    });
  }

  const modeGuidedBtn = document.getElementById('modeGuidedBtn');
  const modeExploreBtn = document.getElementById('modeExploreBtn');
  function setMode(guided){
    state.guided = guided;
    modeGuidedBtn.classList.toggle('active', guided);
    modeExploreBtn.classList.toggle('active', !guided);
    updateGuide();
  }
  modeGuidedBtn.addEventListener('click', () => setMode(true));
  modeExploreBtn.addEventListener('click', () => setMode(false));

  function drawChainArcs(chain){
    const compIds = [...new Set(chain.requires.map(componentIdForRisk))];
    const color = 'var(--sev-critical)';

    if(compIds.length <= 1){
      const n = document.getElementById('node-' + compIds[0]);
      if(n) n.classList.add('pulse');
      return;
    }

    for(let i = 0; i < compIds.length; i++){
      const a = positions[compIds[i]];
      const b = positions[compIds[(i+1) % compIds.length]];
      if(!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const norm = Math.sqrt(dx*dx + dy*dy) || 1;
      const bow = 36;
      const cx = mx - (dy/norm) * bow;
      const cy = my + (dx/norm) * bow;
      const path = el('path', {
        class:'chain-arc',
        d:`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
        stroke: color
      });
      arcLayer.appendChild(path);
      requestAnimationFrame(() => path.classList.add('show'));
    }
  }

  const modalOverlay = document.getElementById('chainModal');
  function showChainModal(chain){
    document.getElementById('mName').textContent = chain.name;
    const sevPill = document.getElementById('mSev');
    sevPill.textContent = chain.severity + ' severity';
    sevPill.style.background = SEV_COLOR[chain.severity];
    sevPill.style.color = '#1a1005';
    const compNames = [...new Set(chain.requires.map(rid => {
      const cid = componentIdForRisk(rid);
      const c = COMPONENTS.find(x => x.id === cid);
      return c ? c.name : '';
    }))];
    document.getElementById('mPath').textContent = compNames.join('  →  ');
    document.getElementById('mNarrative').textContent = chain.narrative;
    document.getElementById('mImpact').textContent = chain.impact;

    const bmeta = BOUNDARY_META[chain.boundary];
    document.getElementById('mEchoTitle').textContent = chain.incident.title + '  ·  ' + bmeta.label;
    document.getElementById('mEchoWhat').textContent = chain.incident.what;
    document.getElementById('mEchoSource').textContent = 'Source: ' + chain.incident.source + (chain.incident.confidence ? ' | Confidence: ' + chain.incident.confidence : '');

    modalOverlay.classList.add('show');
    modalOverlay.dataset.activeChain = chain.id;
  }
  document.getElementById('mClose').addEventListener('click', () => modalOverlay.classList.remove('show'));
  document.getElementById('mViewLibrary').addEventListener('click', () => {
    modalOverlay.classList.remove('show');
    switchTab('library');
  });
  modalOverlay.addEventListener('click', (e) => { if(e.target === modalOverlay) modalOverlay.classList.remove('show'); });

  // ---------------------------------------------------------------
  // STATS
  // ---------------------------------------------------------------
  function updateStats(){
    document.getElementById('statRisksViewed').textContent = state.viewedRisks.size + '/' + TOTAL_RISKS;
    document.getElementById('statChains').textContent = state.discoveredChains.size + '/' + CHAINS.length;
    document.getElementById('tabLibraryCount').textContent = '(' + state.discoveredChains.size + '/' + CHAINS.length + ')';
    document.getElementById('tabCatalogCount').textContent = '(' + TOTAL_RISKS + ')';
  }


  // ---------------------------------------------------------------
  // THREAT CATALOG
  // ---------------------------------------------------------------
  let catalogGroupMode = 'component';
  let catalogSearchText = '';

  function getThreatCatalogRows(){
    return COMPONENTS.flatMap(component => component.risks.map(risk => {
      const chains = CHAINS.filter(chain => chain.requires.includes(risk.id)).map(chain => chain.name);
      return {
        componentId: component.id,
        component: component.name,
        componentTag: component.tag,
        riskId: risk.id,
        risk: risk.name,
        severity: risk.severity,
        impact: risk.impact,
        mitigation: risk.mitigation,
        attackPaths: chains.join('; ')
      };
    }));
  }

  function renderCatalogSummary(rows){
    const summary = document.getElementById('catalogSummary');
    if(!summary) return;
    const total = rows.length;
    const critical = rows.filter(r => r.severity === 'critical').length;
    const high = rows.filter(r => r.severity === 'high').length;
    const components = new Set(rows.map(r => r.component)).size;
    summary.innerHTML = `
      <div class="catalog-metric"><div class="num">${total}</div><div class="lbl">Threats Listed</div></div>
      <div class="catalog-metric"><div class="num">${components}</div><div class="lbl">Components</div></div>
      <div class="catalog-metric"><div class="num">${critical}</div><div class="lbl">Critical</div></div>
      <div class="catalog-metric"><div class="num">${high}</div><div class="lbl">High</div></div>`;
  }

  function renderCatalog(){
    const wrap = document.getElementById('catalogContent');
    if(!wrap) return;
    let rows = getThreatCatalogRows();
    const q = catalogSearchText.trim().toLowerCase();
    if(q){
      rows = rows.filter(row => [
        row.component, row.componentTag, row.riskId, row.risk,
        row.severity, row.impact, row.mitigation, row.attackPaths
      ].join(' ').toLowerCase().includes(q));
    }
    renderCatalogSummary(rows);
    const groups = {};
    rows.forEach(row => {
      const key = catalogGroupMode === 'severity' ? row.severity : row.component;
      if(!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    const groupKeys = Object.keys(groups).sort((a,b) => {
      if(catalogGroupMode === 'severity') return SEV_ORDER[b] - SEV_ORDER[a];
      return a.localeCompare(b);
    });
    if(groupKeys.length === 0){
      wrap.innerHTML = '<p class="guide-tip">No threats match your search.</p>';
      return;
    }
    wrap.innerHTML = groupKeys.map(groupName => {
      const groupRows = groups[groupName].sort((a,b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity] || a.risk.localeCompare(b.risk));
      const rowsHtml = groupRows.map(row => `
        <tr>
          <td data-label="Component"><strong>${escapeHtml(row.component)}</strong><br><span class="case-source">${escapeHtml(row.componentTag)}</span></td>
          <td data-label="Threat">${escapeHtml(row.risk)}<br><span class="case-source">${escapeHtml(row.riskId)}</span></td>
          <td data-label="Severity"><span class="sev-badge" style="background:${SEV_COLOR[row.severity]}">${escapeHtml(row.severity)}</span></td>
          <td data-label="Impact">${escapeHtml(row.impact)}</td>
          <td data-label="Mitigation">${escapeHtml(row.mitigation)}</td>
          <td data-label="Attack Path">${escapeHtml(row.attackPaths || '—')}</td>
        </tr>`).join('');
      return `<section class="catalog-group"><h3>${escapeHtml(labelForCatalogGroup(groupName))}</h3><table class="catalog-table"><thead><tr><th>Component</th><th>Threat</th><th>Severity</th><th>Impact</th><th>Mitigation</th><th>Attack Path</th></tr></thead><tbody>${rowsHtml}</tbody></table></section>`;
    }).join('');
  }

  function labelForCatalogGroup(groupName){
    if(catalogGroupMode !== 'severity') return groupName;
    return groupName.charAt(0).toUpperCase() + groupName.slice(1) + ' Severity';
  }

  function escapeHtml(value){
    return String(value || '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  function csvEscape(value){
    const text = String(value || '');
    return '"' + text.replaceAll('"','""') + '"';
  }

  function triggerDownload(blob, fileName){
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function downloadThreatCatalogJson(){
    const blob = new Blob([JSON.stringify(getThreatCatalogRows(), null, 2)], {type:'application/json'});
    triggerDownload(blob, 'agentic-threat-catalog-v2.json');
  }

  function downloadThreatCatalogCsv(){
    const headers = ['Component','Component Tag','Risk ID','Threat','Severity','Impact','Mitigation','Attack Paths'];
    const rows = getThreatCatalogRows().map(row => [
      row.component, row.componentTag, row.riskId, row.risk,
      row.severity, row.impact, row.mitigation, row.attackPaths
    ].map(csvEscape).join(','));
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], {type:'text/csv;charset=utf-8'});
    triggerDownload(blob, 'agentic-threat-catalog-v2.csv');
  }

  // ---------------------------------------------------------------
  // TABS
  // ---------------------------------------------------------------
  function switchTab(tab){
    const mapBtn = document.getElementById('tabMapBtn');
    const libBtn = document.getElementById('tabLibraryBtn');
    const catalogBtn = document.getElementById('tabCatalogBtn');
    const mapView = document.getElementById('mapView');
    const libView = document.getElementById('libraryView');
    const catalogView = document.getElementById('catalogView');
    const tray = document.getElementById('tray');
    mapBtn.classList.toggle('active', tab === 'map');
    libBtn.classList.toggle('active', tab === 'library');
    catalogBtn.classList.toggle('active', tab === 'catalog');
    mapView.style.display = tab === 'map' ? 'flex' : 'none';
    libView.classList.toggle('active', tab === 'library');
    catalogView.classList.toggle('active', tab === 'catalog');
    tray.style.display = tab === 'map' ? 'flex' : 'none';
    if(tab === 'catalog') renderCatalog();
  }
  document.getElementById('tabMapBtn').addEventListener('click', () => switchTab('map'));
  document.getElementById('tabLibraryBtn').addEventListener('click', () => switchTab('library'));
  document.getElementById('tabCatalogBtn').addEventListener('click', () => switchTab('catalog'));
  document.getElementById('groupByComponentBtn').addEventListener('click', () => { catalogGroupMode = 'component'; renderCatalog(); });
  document.getElementById('groupBySeverityBtn').addEventListener('click', () => { catalogGroupMode = 'severity'; renderCatalog(); });
  document.getElementById('downloadCsvBtn').addEventListener('click', downloadThreatCatalogCsv);
  document.getElementById('downloadJsonBtn').addEventListener('click', downloadThreatCatalogJson);
  const catalogSearchInput = document.getElementById('catalogSearch');
  if(catalogSearchInput){
    catalogSearchInput.addEventListener('input', (e) => { catalogSearchText = e.target.value || ''; renderCatalog(); });
  }

  // ---------------------------------------------------------------
  // INCIDENT LIBRARY
  // ---------------------------------------------------------------
  function openIncidentDrawer(chain){
    state.activeComponent = null;
    const compIds = [...new Set(chain.requires.map(componentIdForRisk))];
    document.querySelectorAll('.node-hit').forEach(n => n.classList.remove('active'));
    compIds.forEach(cid => {
      const n = document.getElementById('node-' + cid);
      if(n) n.classList.add('active');
    });

    drawerEmpty.style.display = 'none';
    drawerContent.style.display = 'none';
    drawerIncident.style.display = 'flex';
    drawerEl.classList.add('open');

    const bmeta = BOUNDARY_META[chain.boundary];
    document.getElementById('iBoundaryDot').style.background = bmeta.color;
    document.getElementById('iBoundaryLabel').textContent = bmeta.label;
    const tagEl = document.getElementById('iBoundaryTag');
    tagEl.style.color = bmeta.color;
    tagEl.style.borderColor = bmeta.color;
    document.getElementById('iTitle').textContent = chain.incident.title;
    document.getElementById('iEchoes').textContent = 'Echoes: ' + chain.name;
    document.getElementById('iWhat').textContent = chain.incident.what;
    const compNames = compIds.map(cid => COMPONENTS.find(c => c.id === cid).name);
    document.getElementById('iChainPath').textContent = compNames.join('  →  ');
    document.getElementById('iNarrative').textContent = chain.narrative;
    document.getElementById('iImpact').textContent = chain.impact;
    document.getElementById('iSource').innerHTML = 'Source: ' + escapeHtml(chain.incident.source) + (chain.incident.sourceUrl ? ' | <a class="source-link" target="_blank" rel="noreferrer" href="' + escapeHtml(chain.incident.sourceUrl) + '">Reference</a>' : '') + (chain.incident.confidence ? ' | Confidence: ' + escapeHtml(chain.incident.confidence) : '');
  }

  document.getElementById('iBackToLibrary').addEventListener('click', () => {
    drawerEl.classList.remove('open');
    document.querySelectorAll('.node-hit').forEach(n => n.classList.remove('active'));
    state.activeComponent = null;
    switchTab('library');
  });

  function renderLibrary(){
    const grid = document.getElementById('libraryGrid');
    grid.innerHTML = '';
    CHAINS.forEach(chain => {
      const unlocked = state.discoveredChains.has(chain.id);
      const bmeta = BOUNDARY_META[chain.boundary];
      const card = document.createElement('div');
      card.className = 'case-card' + (unlocked ? '' : ' locked');

      if(!unlocked){
        card.innerHTML = `
          <div class="lock-icon">🔒</div>
          <div class="lock-title">Classified Case File</div>
          <div class="lock-hint">Discover the matching attack path on the System Map to unlock this real-world case.</div>
        `;
      } else {
        card.innerHTML = `
          <span class="boundary-tag" style="color:${bmeta.color}; border-color:${bmeta.color}">
            <span class="dot" style="background:${bmeta.color}"></span>${bmeta.label}
          </span>
          <div class="case-eyebrow">Echoes: ${chain.name}</div>
          <h3>${chain.incident.title}</h3>
          <div class="case-what">${chain.incident.what}</div>
          <div class="case-echo"><b>Pattern match —</b> ${bmeta.desc}</div>
          <div class="case-source">${chain.incident.source}${chain.incident.confidence ? ' | ' + chain.incident.confidence : ''}</div>
          <button class="view-map-btn" data-chain="${chain.id}">View on Map</button>
        `;
        card.querySelector('.view-map-btn').addEventListener('click', () => {
          switchTab('map');
          drawChainArcs(chain);
          openIncidentDrawer(chain);
        });
      }
      grid.appendChild(card);
    });
  }

  // ---------------------------------------------------------------
  // HINT
  // ---------------------------------------------------------------
  const hintBanner = document.getElementById('hintBanner');
  document.getElementById('hintBtn').addEventListener('click', () => {
    const remaining = CHAINS.filter(c => !state.discoveredChains.has(c.id));
    if(remaining.length === 0){
      hintBanner.textContent = "You've found every attack path. Nice work.";
      hintBanner.classList.add('show');
      clearTimeout(state.hintTimer);
      state.hintTimer = setTimeout(() => hintBanner.classList.remove('show'), 3200);
      return;
    }
    const chain = remaining[Math.floor(Math.random() * remaining.length)];
    const compIds = [...new Set(chain.requires.map(componentIdForRisk))];
    const compNames = compIds.map(id => COMPONENTS.find(c => c.id === id).name);
    hintBanner.textContent = 'Try combining risks from: ' + compNames.join(' + ');
    hintBanner.classList.add('show');
    compIds.forEach(id => {
      const n = document.getElementById('node-' + id);
      if(n) n.classList.add('pulse');
    });
    clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => {
      hintBanner.classList.remove('show');
      compIds.forEach(id => {
        const n = document.getElementById('node-' + id);
        if(n && !hasActiveArcNode(id)) n.classList.remove('pulse');
      });
    }, 4200);
  });

  function hasActiveArcNode(id){
    // keep pulse if this node is part of an already-discovered single-node chain
    for(const chainId of state.discoveredChains){
      const chain = CHAINS.find(c => c.id === chainId);
      const compIds = [...new Set(chain.requires.map(componentIdForRisk))];
      if(compIds.length === 1 && compIds[0] === id) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // RESET / INTRO
  // ---------------------------------------------------------------
  document.getElementById('resetBtn').addEventListener('click', () => {
    state.basket.clear();
    state.viewedRisks.clear();
    state.discoveredChains.clear();
    state.activeComponent = null;
    renderTray();
    updateStats();
    clearArcs();
    renderLibrary();
    switchTab('map');
    drawerEl.classList.remove('open');
    document.querySelectorAll('.node-hit').forEach(n => n.classList.remove('active','pulse','guide-pulse'));
    updateGuide();
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('introOverlay').classList.add('hide');
    setTimeout(() => document.getElementById('introOverlay').remove(), 320);
  });

  setupMapControls();
  updateStats();
  renderTray();
  renderLibrary();
  updateGuide();

})();
