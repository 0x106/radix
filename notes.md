# Radix

Radix is a platform designed to let users and AI agents collaboratively build disposable, interactive software prototypes. To prevent the
AI from starting from scratch every time, the platform provides a "pantry" of pre-built technical primitives. This includes UI "shells"
for different surfaces (web, mobile, CLI, desktop) and a library of standardized mock services (auth, databases, payments) that operate
entirely in-memory with fake delays and resetting states. By confining the prototype to a single language environment (like JavaScript)
and strictly mocking all external dependencies, the agent can rapidly wire together functional-looking applications without getting
bogged down by production infrastructure or edge cases.

Technically, the system is designed around an "extraction-based" architecture rather than a rigid, top-down specification. To preserve the
AI's ability to improvise or "fudge" logic, the agent freely builds the mock application first. A lightweight extraction layer then reads
the resulting code to generate abstract, non-text visual representations (such as state machines or flow diagrams) that the user can interact
with. The only exception to this flexible approach is the data model: the platform uses a thin, authoritative data schema to define entities
and relationships. This schema acts as a single source of truth to automatically generate the mock database shape, seed data, and UI forms,
ensuring structural consistency while keeping the behavioral logic entirely flexible.

- model all code in javascript
  - easy to prototype with
  - easy to simulate interfaces etc
  - easy to integrate mock third party services
  - 'in js' is a red herring
    - the important bit is that everything can be mocked
  - can verify, model, test, analyse, prototype
    -- a "prototype engine for software"
  - can build the holistic view UI around it
  - can subsume eval platform into it
  - monitoring

- user submits first request / general outline
- agent runs an interrogation loop to build a better description
- agent builds data schema

---

Radix is a prototyping tool for software. Users collaborate with an agent to build a working prototype of (ultimately) any type of application;
with external services, users, and databases all mocked as necessary. The radix runtime provides simulation tools for running the prototype
as if it was running in its native environment. Web apps run as if they're in a browser, mobile apps as if they're on a mobile device,
native applications as if they're running on a host operating system. Where the simulation environment can't provide adequate simulation (i.e.
in cases where emulation is too difficult) the agent either builds what it can or gracefully falls back and explains to the user.

The goal is to get to a working version of the application as quickly as possible, so that the user can experiment, explore, critique, discuss,
test, and evaluate before they start writing real code. Other existing tools strive to implement a fully working version of a particular application,
but they often fall short at the design, iteration, test stage.

In the first version we are going to write everything in Javascript, and it will be running on the web. This is a deliberate choice to limit
the surface area of code that the agent has to reason about, and because JS is an excellent choice for building mocked applications for a
variety of runtimes.

The process starts with a user submitting a general description of what they want to build. The agent spends some time querying the user to find
out further details, and to get a better idea of what exactly they're building. The core of the application that they build is based around a
data schema, and an auto-generated database. The agent then builds an API to interact with the database, and begins building any interfaces / UI
(if necessary) and the relevant components. Any necessary services are mocked, i.e. user authentication, stripe, sensor access, etc etc.

Importantly, we provide the agent with a comprehensive library of prebuilt templates, runtimes, components, services, and tools. Where something
doesn't exist the agent can generate it and add it to the library. During development I am going to get an agent to generate large numbers of
test applications and map out the types of library elements that will be necessary.

- We can simulate real behaviour, so you can see how things perform before commiting engineering resources.
- Users could be asked to upload real data -- maybe it would build a data capture pipeline for them to use?
