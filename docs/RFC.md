# RFC transport for older on-premise systems

On an on-premise system with SAP_BASIS below 7.51, abap-adt-mcp can read everything over HTTP but cannot write: locks do not survive from one request to the next. The RFC transport fixes that by sending the same ADT requests over an RFC connection, the way Eclipse does. It needs one thing this package cannot ship: the SAP NetWeaver RFC SDK, which every user downloads from SAP with their own S-user.

This guide covers when you need it, how to get and install the SDK, how to configure a destination, what the SAP system must allow, and what the errors mean. The key reference lives in [CONFIGURATION.md](CONFIGURATION.md#rfc-transport-on-premise-sap_basis-below-751).

## Do you need it?

You need the RFC transport when both are true:

- The system runs SAP_BASIS 7.50 or lower. That covers SAP ERP 6.0 up to EHP8 (EHP7 runs on 7.40, EHP8 on 7.50) and other NetWeaver 7.3x to 7.50 systems. S/4HANA on-premise 1610 and later ship 7.51 or higher and do not need it, nor does S/4HANA Cloud.
- You want to write: create or change objects, activate, run refactorings. For reading, HTTP is enough on any release.

To see the release, open SAP GUI and choose System, Status (in newer SAP GUI versions the System menu sits under More). Click the button for the component information and read the line `SAP_BASIS`.

The symptoms over HTTP on such a system are easy to recognise:

- Reading sources, searching and where-used work.
- The first write fails with HTTP 423 and a message like `Resource INCLUDE ZMY_REPORT is not locked (invalid lock handle)`, although the lock call just before it succeeded.
- `systemProfile` lists very few ADT collections. A 7.40 system can show a single one, the BW Query Designer.

### Why HTTP cannot write there

ADT writes in two steps: lock the object, then send the source with the lock handle. Both steps must run in the same ABAP session. Over HTTP the client asks for that with the header `X-sap-adt-sessiontype: stateful`, and the ADT handler honours it from SAP_BASIS 7.51 on. Older handlers ignore the header, so each request runs in a session of its own and the lock is released when the lock request ends. No SICF setting or profile parameter changes that.

Eclipse is not affected because on-premise ABAP projects talk RFC: each ADT request becomes one call of the function module `SADT_REST_RFC_ENDPOINT` over a persistent RFC connection, and that connection is one ABAP session for as long as it stays open. `"transport": "rfc"` does exactly that. The tools, the policies and the error hints stay the same; only the way the requests travel changes.

There is one alternative on the SAP side: a small enhancement in the system that makes the HTTP handler honour the session header (the community project [abapfs_extensions](https://github.com/marcellourbani/abapfs_extensions) is one). It modifies the behaviour of a standard class, needs the approval of whoever owns the system, and is not covered here.

## Why you download the SDK yourself

abap-adt-mcp cannot include the SAP NetWeaver RFC SDK, and it never downloads it for you. SAP's licence terms for its connectors (JCo, NCo and the NetWeaver RFC SDK, published on the [SAP Connectors page](https://support.sap.com/en/product/connectors.html)) do not allow redistribution. That rules out the npm package, this repository, the GitHub releases and the container image, whether the files are renamed, repackaged or not. Having an S-user does not change it: the S-user gives its company the right to download the software for its own licensed use, not to republish it.

So each user, or each company for its own staff, downloads the SDK once from SAP. The server only loads the libraries from the folder you point it at.

The SDK is current software, not a leftover: SAP keeps publishing patch levels of the 7.50 SDK and supports the latest one (see SAP Note 2573790). What SAP stopped maintaining in 2024 were its open-source wrappers around the SDK (node-rfc, PyRFC and gorfc). abap-adt-mcp does not use them; it has its own small binding and needs only the SDK libraries.

## Get the SDK

Download links (SAP pages; they ask for your S-user login):

- **Download:** [SAP NW RFC SDK 7.50 in the SAP Software Download Center](https://me.sap.com/softwarecenter/search/SAP%20NW%20RFC%20SDK%207.50)
- **Product page:** [SAP NetWeaver RFC SDK on the SAP Support Portal](https://support.sap.com/en/product/connectors/nwrfcsdk.html), with the release notes and the documentation
- **Platforms and support:** [SAP Note 2573790](https://me.sap.com/notes/2573790)

You need an S-user of an SAP customer or partner with the authorization to download software. If SAP for Me shows "You don't have proper authorization to download software", ask the S-user administrator of your company to grant you the Software Download authorization (SAP for Me, Users and Contacts).

1. Open the [download link](https://me.sap.com/softwarecenter/search/SAP%20NW%20RFC%20SDK%207.50) above and log in. It searches the SAP Software Download Center for `SAP NW RFC SDK 7.50`. If you land on the SAP for Me start page or see no result after the login, open the link once more, or browse to it: Software Downloads, Support Packages and Patches, the alphabetical index, letter N, SAP NW RFC SDK, SAP NW RFC SDK 7.50.
2. Open the result `SAP NW RFC SDK 7.50`, which lists the support packages and patches.
3. In the operating system list, pick the one that matches the Node.js that runs abap-adt-mcp. This command prints it; on Windows, run it in PowerShell (Start menu, PowerShell):

   ```bash
   node -p "process.platform + ' ' + process.arch"
   ```

   | Node.js reports | Choose in the list |
   |---|---|
   | `darwin arm64` (Mac with Apple silicon) | MACOS ON ARM64 64BIT |
   | `darwin x64` (Intel Mac) | MACOS X 64-BIT |
   | `win32 x64` (almost every Windows PC) | WINDOWS ON X64 64BIT |
   | `linux x64` | LINUX ON X86_64 64BIT |
   | `linux arm64` | LINUX ON ARM 64BIT |

   The list has no Windows build for ARM. On a Windows laptop with an ARM processor (`win32 arm64`), install the x64 Node.js, which Windows runs in emulation, and use the x64 SDK.

4. Download the ZIP with the highest patch level. The file name carries the patch level and a platform number, for example `nwrfc750P_20-80008131.zip` for patch level 20 on macOS ARM64 (about 5 MB) or `nwrfc750P_20-70002755.zip` on Windows x64 (about 21 MB). A newer patch level simply has a higher number.

An SDK built for another architecture cannot be loaded: an x64 SDK does not work with an arm64 Node.js, and the other way round.

## Install it

The ZIP contains one folder, `nwrfcsdk`, with `lib`, `include`, `bin`, `demo` and `doc` inside. The server uses only `lib`. The folder you will name in the configuration is that `nwrfcsdk` folder, the one that contains `lib`.

The simplest place, the same on every platform, is a folder `sap` in your home folder, so that the SDK ends up in `~/sap/nwrfcsdk`; `~` means your home folder on Windows too (`C:\Users\<you>`). Then `"sdkPath": "~/sap/nwrfcsdk"` works unchanged everywhere.

Where the server looks, in this order:

1. `rfc.sdkPath` on the destination.
2. The environment variable `SAPNWRFC_HOME`.
3. The default folder: `/usr/local/sap/nwrfcsdk` on macOS and Linux, `C:\nwrfcsdk` on Windows.

The package installs a small helper, [koffi](https://koffi.dev), as an optional dependency with prebuilt binaries for macOS, Windows and Linux, and the server loads the SDK through it the first time an RFC destination is used. Its install script only checks that the prebuilt binary loads; on a platform where it does not, it tries to build koffi from source with CMake, and if that fails too the optional dependency is skipped without breaking the installation. Destinations without `"transport": "rfc"` never load anything.

The SDK keeps a log of its own, `dev_rfc.log`, and writes trace files when tracing is on. The server points it at `~/.abap-adt-mcp/rfc` (readable by you only), so nothing lands in the folder the host started in, which in Claude Code is your project. A `sapnwrfc.ini` is read from that folder only, never from your project; you only need one there if SAP support asks you for an RFC trace.

### macOS

```bash
mkdir -p ~/sap
```

```bash
unzip ~/Downloads/nwrfc750P_20-80008131.zip -d ~/sap
```

The SDK is then in `~/sap/nwrfcsdk`. The classic location `/usr/local/sap/nwrfcsdk` works as well, but on Macs with Apple silicon `/usr/local` belongs to the system and needs `sudo`.

The libraries are signed by SAP and notarized by Apple, so macOS loads them although the browser marked the download. If loading still fails with a message that the developer cannot be verified, clear the mark on the folder:

```bash
xattr -dr com.apple.quarantine ~/sap/nwrfcsdk
```

### Windows

1. In File Explorer, right-click the ZIP and choose Extract All.
2. As the destination, type `C:\Users\<you>\sap` (your user name in place of `<you>`). Do not add `nwrfcsdk` to the end: the ZIP already contains that folder.
3. Check that the file `C:\Users\<you>\sap\nwrfcsdk\lib\sapnwrfc.dll` exists. If you got `...\nwrfcsdk\nwrfcsdk\lib` instead, move the inner `nwrfcsdk` folder up one level.

Use `"sdkPath": "~/sap/nwrfcsdk"`, or write the full path with forward slashes, `"C:/Users/<you>/sap/nwrfcsdk"` (JSON needs `\\` for every backslash; forward slashes need nothing). With the SDK in `C:\nwrfcsdk` you can leave `sdkPath` out. The server adds the SDK's `lib` folder to its own `PATH` before loading it, so the system `PATH` does not have to change.

The SDK needs the Microsoft Visual C++ 2015-2022 runtime (`VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `MSVCP140.dll`). Most Windows machines have it. If loading fails with one of those names, install the x64 package from Microsoft's page [Latest supported Visual C++ Redistributable downloads](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist). It needs administrator rights, so on a managed laptop ask your IT department.

### Linux

```bash
mkdir -p ~/sap && unzip ~/Downloads/nwrfc750P_*.zip -d ~/sap
```

Install `libuuid` (`libuuid1` on Debian, Ubuntu and SUSE, `libuuid` on RHEL). The server loads the SDK's own companion libraries from `lib` first. If loading still fails because a library is not found, register the folder with the loader: put its path in a file under `/etc/ld.so.conf.d/` and run `ldconfig`, or start the host with `LD_LIBRARY_PATH` set to it. `ldd ~/sap/nwrfcsdk/lib/libsapnwrfc.so` shows what is missing.

## Configure the destination

### Where the file is

`systems.json` is the file that `SAP_SYSTEMS_FILE` names in your host configuration. With the setup in the README it is `~/.abap-adt-mcp/systems.json`, which on Windows is `C:\Users\<you>\.abap-adt-mcp\systems.json`. Open it in a text editor (Notepad on Windows).

The system probably has an entry already. Add two keys to it, `transport` and `rfc`, and leave the rest as it is. The examples below show a whole file with one entry; when your file has several entries, copy only the two keys into the existing entry, and mind the commas between keys and between entries, or the server stops with `is not valid JSON`.

Tip: before you switch the entry, copy it under a second name (for example `ECC-DEV-HTTP`, without `transport` and `rfc`). After the switch every call on the RFC entry goes over RFC, reads included, so the copy keeps reading over HTTP while you finish the RFC setup.

### The values

The values come from SAP Logon: right-click the entry of the system, choose Properties, and look at the Connection tab.

| SAP Logon shows | Goes into |
|---|---|
| Application Server | `rfc.ashost` |
| Instance Number | `rfc.sysnr`, two digits as a string: `"00"`, not `0` |
| SAProuter String, if there is one | `rfc.saprouter` |
| Message Server and Group, instead of an application server | `rfc.mshost`, `rfc.sysid` (the System ID) and `rfc.group` |

`rfc.ashost` is often a different host from the one in `url`: `url` usually names a web address (sometimes a Web Dispatcher or load balancer), while RFC goes to the application server itself. Keep `url` as your entry already has it; it stays required, because the SSO login runs against it and `listSystems` shows it.

### Examples

With browser SSO, which reuses the logon ticket of the browser login for the RFC connection:

```json
{
  "ECC-DEV": {
    "url": "https://ecc-dev.example.com:44300",
    "client": "100",
    "language": "EN",
    "authType": "sso",
    "transport": "rfc",
    "rfc": {
      "ashost": "ecc-app1.example.com",
      "sysnr": "00",
      "sdkPath": "~/sap/nwrfcsdk"
    },
    "policy": { "allowedPackages": ["Z*", "Y*", "$*"] }
  }
}
```

With user and password from the environment:

```json
{
  "ECC-DEV": {
    "url": "https://ecc-dev.example.com:44300",
    "client": "100",
    "authType": "basic",
    "user": "DEVELOPER",
    "password": "${env:ECC_DEV_PASSWORD}",
    "transport": "rfc",
    "rfc": { "ashost": "ecc-app1.example.com", "sysnr": "00", "sdkPath": "~/sap/nwrfcsdk" }
  }
}
```

Claude Desktop does not read variables from your shell: put `"ECC_DEV_PASSWORD": "..."` in the `env` block of the abap-adt-mcp entry in `claude_desktop_config.json`, as the README describes in its setup step 4.

More points that are easy to get wrong:

- `client` is required, because an RFC logon always names its client. `language` becomes the logon language and decides the original language of new objects; it is `EN` when omitted.
- `authType: "oauth"` is refused for RFC destinations, because an OAuth token cannot log on to an RFC connection.
- Every `rfc` key is described in [CONFIGURATION.md](CONFIGURATION.md#rfc-transport-on-premise-sap_basis-below-751).

### Restart the host

The server reads `systems.json` only when it starts.

- Claude Desktop on Windows: closing the window is not enough. Right-click the Claude icon in the notification area (next to the clock), choose Quit, then open Claude again.
- Claude Desktop on macOS: choose Quit Claude (Cmd+Q), then open it again.
- Claude Code: start a new session.

Then ask for `listSystems`: the destination must show `"transport": "rfc"`.

## What the SAP system must allow

- **The gateway port.** The RFC connection goes to the SAP gateway of the instance, port `33` followed by the instance number: `3300` for instance `00`. It must be reachable from the machine that runs abap-adt-mcp, usually through the company VPN. SAP GUI working does not prove it: SAP GUI uses port `32<nn>`, RFC uses `33<nn>`. A quick check on macOS or Linux:

  ```bash
  nc -z -w 5 ecc-app1.example.com 3300 && echo open
  ```

  and on Windows PowerShell, where `TcpTestSucceeded : True` means the port is open:

  ```powershell
  Test-NetConnection ecc-app1.example.com -Port 3300
  ```

  If the port is closed, ask the network team or Basis to open it, or use the SAProuter of your SAP Logon entry in `rfc.saprouter`. With a SAProuter the connection goes to the SAProuter host instead, port `3299` by default, so check that host and port. If Eclipse ADT reaches the system from the same machine, the port is already open.
- **The RFC authorization.** The SAP user needs `S_RFC` for the function module `SADT_REST_RFC_ENDPOINT` (`RFC_TYPE` = `FUNC`, `RFC_NAME` = `SADT_REST_RFC_ENDPOINT`, `ACTVT` = `16`). Eclipse calls the same module, so a user who works with Eclipse ADT on that system already has it. The error for a missing authorization is described in SAP KBA 3569684.
- **Logon tickets, for `authType: "sso"`.** The system must issue a logon ticket at the browser login and accept it for RFC: profile parameters `login/create_sso2_ticket` set to `1` or `2` and `login/accept_sso2_ticket` set to `1`. Basis can check them in `RZ11`. The ticket is a cookie for the system's DNS domain, so `url` must use the full host name (for example `https://sapdev.example.com:44300`), not an IP address. If the system does not issue tickets, use `authType: "basic"` for that destination.
- **No SNC requirement.** The RFC connection is opened without SNC; the `rfc` block has no SNC settings yet. If your SAP Logon entry or your Eclipse ADT project has Secure Network Communication switched on, ask Basis whether the system accepts RFC logons without SNC (profile parameter `snc/accept_insecure_rfc`). If it does not, the RFC transport cannot log on to that system for now.

## First run

1. Restart the host as above. `listSystems` shows the destination with `"transport": "rfc"`.
2. Ask the model to log in to the destination. With SSO the browser window opens as before.
3. Ask for `systemProfile` of the destination with `refresh: true`. It now reads the ADT collections the RFC endpoint offers, which on these releases is usually a much longer list than the HTTP discovery returned.
4. Note that `abap-adt-mcp --check` tests only the HTTPS `url` of a destination; the SDK and the gateway port of an RFC destination are checked on its first call, or by hand with the port check above.
5. Try a small write in `$TMP`: create a test program, write its source and activate it. The policy of the entry must allow `$TMP` (`"$*"` in `allowedPackages`); a `policyDenied` answer comes from the policy, not from the RFC setup.

## Sessions

Each RFC destination keeps two RFC connections by default (`"sessions": "split"` inside the `rfc` block), as Eclipse does. One carries only lock and unlock requests and holds the locks; the other carries everything else and is reset after every write, so a leftover session buffer cannot disturb the next request. Setting `"sessions": "single"` in the `rfc` block puts everything on one connection; it is meant as a fallback if a system misbehaves with `split`.

On SAP_BASIS 7.40 the transport services live at an older address (`/sap/bc/cts/` instead of `/sap/bc/adt/cts/`); the server notices the first time a transport call is answered with 404 and uses the older address from then on, so transport tools work there too.

Connections open on first use and reopen by themselves after the network or the gateway dropped them. An ABAP message or a short dump in the endpoint ends the session of its connection as well (the SDK closes the connection after them); the error itself is reported and the next call opens a new connection. Locks live in the ABAP session of the lock connection: when that connection ends for any of these reasons, its locks are gone and the error says so. Lock the object again and repeat the write.

## When something goes wrong

Every failure to find or load the SDK is reported with kind `rfcSdkMissing`; the message says which case it is.

| What you see | Cause | What to do |
|---|---|---|
| `SAP NetWeaver RFC SDK not found: looked for ...` | No SDK at the path the message names | Check `rfc.sdkPath` or `SAPNWRFC_HOME`; it must name the `nwrfcsdk` folder that contains `lib`. On Windows look for a doubled `nwrfcsdk\nwrfcsdk`. |
| `SAP NetWeaver RFC SDK found at ... but it could not be loaded` | The system refused to load the library | Usually the wrong architecture (compare with the `node -p` line above), the Visual C++ runtime on Windows, `libuuid` on Linux, or the quarantine mark on macOS. The message names the fix for your platform. |
| `The RFC transport needs the optional dependency koffi` | npm skipped the optional dependencies | Run `npm config get omit`. If it lists `optional` (often set in a company `.npmrc`), remove that setting, delete the npx cache folder (`~/.npm/_npx` on macOS and Linux, `%LOCALAPPDATA%\npm-cache\_npx` on Windows) and restart the host, so that npx installs the package again. |
| `RFC connection to ... could not be opened (RFC_COMMUNICATION_FAILURE)` (kind `network`) | The gateway is not reachable | Check the VPN, `rfc.ashost`, the instance number and the port check above; add `rfc.saprouter` if the system is only reachable through a SAProuter. |
| `RFC logon to ... was refused` (kind `authorization`, `authType: "basic"`) | Wrong user or password, a locked user, or SNC required | The server makes no further password logon for that destination until you call login or restart the host, so failed attempts cannot add up to a locked SAP user. Fix the password (systems.json or its environment variable), check the user in `SU01` and the SNC point above, then restart the host. |
| `RFC logon to ... failed` (kind `sessionExpired`, `authType: "sso"` or `"sso2"`) | The logon ticket expired or was refused | The server runs the login again once by itself (a browser window for SSO). If it keeps failing, ask Basis about the ticket parameters above. |
| `the browser login yielded no logon ticket` | SSO login without a `MYSAPSSO2` ticket | Most often `url` names the system by IP address or short host name: SAP issues the ticket for its DNS domain (`login/ticket_only_to_host = 0`, the default), and the browser refuses that cookie on an address. Put the full host name in `url` (with an `/etc/hosts` entry if DNS does not resolve it). Otherwise ask Basis about `login/create_sso2_ticket`, or use `authType: "basic"`. |
| `No RFC authorization for function module SADT_REST_RFC_ENDPOINT` | Missing `S_RFC` | Ask for the authorization described above (SAP KBA 3569684). |
| Kind `rfcSessionLost` | The connection that held the locks ended (network, gateway, an ABAP error in it) | Lock the object again, then repeat the write. |
| `RFC connection to ... lost` (kind `network`) | The connection that carries the other requests dropped; the locks are still held | The server reconnects on the next call. After a failed write, read the object before repeating it. |
| An error naming the interface of `SADT_REST_RFC_ENDPOINT` | The system's endpoint has a structure this server does not know | Report it with the SAP_BASIS release of the system; nothing on your side fixes it. |
| Writes still fail with an invalid lock handle | The destination still uses HTTP | Check that `"transport": "rfc"` is in the right entry and that the host was really restarted; `listSystems` must show it. |

## Shared servers and containers

The published abap-adt-mcp image is built on Alpine Linux, and the SAP NetWeaver RFC SDK exists only for Linux distributions with glibc, so that image serves HTTP destinations only. The rule about redistribution applies to images as well: no image given to others may contain the SDK.

For RFC destinations in a container, build an image of your own on a Debian or Ubuntu base and mount the Linux SDK that matches its architecture at run time. A minimal example:

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libuuid1 && rm -rf /var/lib/apt/lists/*
RUN npm install -g abap-adt-mcp
USER node
ENTRYPOINT ["abap-adt-mcp"]
```

```bash
docker run -i -v /opt/sap/nwrfcsdk:/opt/sap/nwrfcsdk:ro -e SAPNWRFC_HOME=/opt/sap/nwrfcsdk -v ~/.abap-adt-mcp:/home/node/.abap-adt-mcp -e SAP_SYSTEMS_FILE=/home/node/.abap-adt-mcp/systems.json my-abap-adt-mcp
```

The container also needs a route to the gateway port. Every caller of a shared server uses the RFC logon of the destination, exactly as with HTTP destinations.

## Questions

**Can the SDK be attached to a GitHub release of abap-adt-mcp, or shipped in some other form?** No. The connector licence does not allow redistribution, and renaming or stripping the files does not change that. Only SAP can grant other terms.

**Does Eclipse have to be installed?** No. abap-adt-mcp calls the same function module Eclipse calls, through the SDK.

**Does the RFC transport change anything for HTTP destinations?** No. It is chosen per destination, and only RFC destinations load the SDK.

**Is the NW RFC SDK obsolete?** No. SAP still publishes and supports it; only SAP's open-source wrappers around it were discontinued.
