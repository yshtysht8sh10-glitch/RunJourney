package app.runjourney.legacy

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class LegacyStorageReaderModule : Module() {
  private val worker = Executors.newSingleThreadScheduledExecutor()
  private var reader: LegacyStorageReader? = null

  private fun dispatch(promise: Promise, action: (LegacyStorageReader) -> Any?) {
    worker.execute {
      try {
        val current = reader ?: LegacyStorageReader(requireNotNull(appContext.reactContext)).also { reader = it }
        promise.resolve(action(current))
      } catch (error: Exception) {
        // No database values/coordinates or arbitrary filesystem paths in errors.
        val reason = error.message?.takeIf { it.matches(Regex("LEGACY_[A-Z_]+")) }
          ?: "LEGACY_SQLITE_READ_FAILED"
        promise.reject("ERR_LEGACY_STORAGE_READ", reason, null)
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LegacyStorageReader")
    OnCreate {
      worker.scheduleAtFixedRate({ try { reader?.expire() } catch (_: Exception) { } }, 30, 30, TimeUnit.SECONDS)
    }
    AsyncFunction("open") { promise: Promise -> dispatch(promise) { it.open() } }
    AsyncFunction("read") { token: String, key: String, offset: Int, promise: Promise -> dispatch(promise) { it.read(token, key, offset) } }
    AsyncFunction("close") { token: String, promise: Promise -> dispatch(promise) { it.close(token); null } }
    OnDestroy {
      worker.execute { try { reader?.closeAll() } finally { worker.shutdown() } }
    }
  }
}
