import Foundation
import Security
import CryptoKit
import Darwin

let service = "RyanOS Tasks API"
let account = "personal-assistant"
struct Credential: Codable {
    let token: String
    let integrationId: String
    let userId: String
    let expiresAt: String
}
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1)
}
func digest(_ token: String) -> String { SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined() }
func metadata(_ value: Credential) -> [String: String] {
    ["integrationId": value.integrationId, "userId": value.userId, "expiresAt": value.expiresAt, "tokenHash": digest(value.token)]
}
func output(_ data: Data) { FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10])) }
func pipeOnly() {
    var info = stat()
    guard fstat(STDOUT_FILENO, &info) == 0 else { fail("Private pipe required") }
    let kind = info.st_mode & S_IFMT
    guard kind == S_IFIFO || kind == S_IFSOCK else { fail("Credential read requires an anonymous pipe; terminal/file output refused") }
}
let mode = CommandLine.arguments.dropFirst().first ?? ""
if mode == "self-test" {
    // Pure memory only: no random generation, Keychain calls, or real credential.
    let dummy = Credential(token: "synthetic_test_only_000000000000000000000000", integrationId: "00000000-0000-4000-8000-000000000001", userId: "00000000-0000-4000-8000-000000000002", expiresAt: "2026-11-13T00:00:00Z")
    guard digest(dummy.token).count == 64, metadata(dummy)["token"] == nil,
          (try? JSONDecoder().decode(Credential.self, from: JSONEncoder().encode(dummy)).token) == dummy.token else { fail("Self-test failed") }
    output(Data("{\"ok\":true,\"keychainAccessed\":false}".utf8)); exit(0)
}
guard ["create", "metadata", "read-pipe"].contains(mode) else { fail("Use create, metadata, read-pipe or self-test") }
let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
if mode == "create" {
    guard isatty(STDIN_FILENO) != 0, CommandLine.arguments.count == 3,
          UUID(uuidString: CommandLine.arguments[2]) != nil else { fail("User-operated terminal and owner UUID required") }
    FileHandle.standardError.write(Data("Creates a 30-day credential in Keychain for all RyanOS items. Type CREATE RYANOS CREDENTIAL to continue: ".utf8))
    guard readLine() == "CREATE RYANOS CREDENTIAL" else { fail("Cancelled") }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { fail("Secure random generation failed") }
    let token = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    let value = Credential(token: token, integrationId: UUID().uuidString.lowercased(), userId: CommandLine.arguments[2].lowercased(), expiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(30 * 86400)))
    guard let encoded = try? JSONEncoder().encode(value) else { fail("Credential encoding failed") }
    var add = base
    add[kSecValueData as String] = encoded
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    add[kSecAttrSynchronizable as String] = false
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else { fail(status == errSecDuplicateItem ? "Entry already exists; do not overwrite. Use metadata/resume or review rotation." : "Keychain refused credential storage") }
    guard let result = try? JSONSerialization.data(withJSONObject: metadata(value)) else { fail("Metadata encoding failed") }
    output(result); exit(0)
}
if mode == "read-pipe" { pipeOnly() }
var query = base
query[kSecReturnData as String] = true
query[kSecMatchLimit as String] = kSecMatchLimitOne
var found: CFTypeRef?
guard SecItemCopyMatching(query as CFDictionary, &found) == errSecSuccess,
      let data = found as? Data, let value = try? JSONDecoder().decode(Credential.self, from: data) else { fail("Keychain access unavailable; use the approved user handoff") }
if mode == "read-pipe" { output(data) }
else {
    guard let result = try? JSONSerialization.data(withJSONObject: metadata(value)) else { fail("Metadata encoding failed") }
    output(result)
}
