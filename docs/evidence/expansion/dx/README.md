# Contributor experience evidence

Automation and human setup are separate evidence. A warm dependency cache or an agent-controlled browser does not establish a human cold-start time.

| Check | Evidence status |
| --- | --- |
| Executable contributor examples | Run `npm run test:examples`; exact output belongs with the reviewed commit |
| Documentation references/scripts/config | Run `npm run test:docs` on the integrated checkout |
| Missing Docker, occupied port, wrong project, remote refusal, missing provider config, secret exclusion | Run `npm run test:dx`; isolated negative fixtures never reset a real stack |
| Guest saved/reloaded checkpoint | Browser regression evidence exists separately; clean-install timing must be recorded below |
| Linux cold human walkthrough | UNMEASURED |
| macOS cold human walkthrough | UNMEASURED |
| Windows contributor path | UNQUALIFIED; do not infer support from Node compatibility |
| Physical iOS/Android contributor walkthrough | UNMEASURED; simulator/emulator bridge evidence is separate |

For each future walkthrough, record: participant/OS/tool versions; commit; README entry point; installed prerequisites; cache state; start time; dependency download wait; each confusion/error; first successful saved-and-reloaded checkpoint time; export success; changes made after feedback; retest. Target under five minutes with Node/npm already installed, including cold dependency download. Keep participant identity private; an anonymous label suffices in source evidence.

No human result is fabricated here. Native runtime results and license scope are in [native evidence](../native/licenses/inventory.json); provider/store/physical-device qualification is in the [release record](../../../release/qualification.md).
