package app.runjourney.markerprobe;

import java.util.HashSet;
import java.util.Set;

/** Bounded raw-key policy: a down/up pair or repeat must not create two markers. */
public final class MarkerKeys {
  private final Set<String> seen = new HashSet<>();
  private final Set<Integer> down = new HashSet<>();
  public String admit(boolean relevant, int action, int repeat, int device, long downTime) {
    if (!relevant) return "UNRELATED";
    if (action == 1) { down.remove(device); return "NOT_DOWN"; }
    if (action != 0) return "NOT_DOWN";
    if (repeat != 0) return "REPEAT";
    if (down.contains(device)) return "DUPLICATE_DOWN";
    String key = device + ":" + downTime;
    // Some AVRCP remotes report zero for every event. A completed down/up cycle
    // is then the only available identity; zero must not enter the seen set.
    if (downTime > 0 && seen.contains(key)) return "DUPLICATE";
    if (seen.size() >= 1024 || down.size() >= 32) return "CAPACITY";
    if (downTime > 0) seen.add(key);
    down.add(device);
    return "ACCEPTED";
  }
}
