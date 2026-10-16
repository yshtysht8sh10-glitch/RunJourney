package app.runjourney.storage

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class IsolatedStorageModule : Module() {
  private fun store(): IsolatedFileStore {
    val context = requireNotNull(appContext.reactContext)
    check(context.packageName == "app.runjourney.mobile.test") { "Isolated recovery build is Test-only" }
    return IsolatedFileStore(context.filesDir)
  }
  override fun definition() = ModuleDefinition {
    Name("RunJourneyIsolatedStorage")
    AsyncFunction("getItem") { key: String -> store().getItem(key) }
    AsyncFunction("setItem") { key: String, value: String -> store().setItem(key, value) }
    AsyncFunction("removeItem") { key: String -> store().removeItem(key) }
  }
}
