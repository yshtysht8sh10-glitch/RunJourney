package app.runjourney.rescue;

import android.app.Application;

/** No startup hooks, database helpers, migrations, tracking or application dependencies. */
public final class RescueApplication extends Application {
    @Override public void onCreate() { super.onCreate(); }
}
