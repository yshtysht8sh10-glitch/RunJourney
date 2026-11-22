package app.runjourney.markerprobe;

/** Standalone JVM test; no phone, audio, GPS or real data. */
public final class MarkerKeysTest {
  private static int checks;
  private static void equal(String actual, String expected) {
    checks++; if (!expected.equals(actual)) throw new AssertionError(expected + " != " + actual);
  }
  public static void main(String[] args) {
    MarkerKeys keys = new MarkerKeys();
    equal(keys.admit(false, 0, 0, 1, 1), "UNRELATED");
    equal(keys.admit(true, 1, 0, 1, 1), "NOT_DOWN");
    equal(keys.admit(true, 0, 1, 1, 1), "REPEAT");
    equal(keys.admit(true, 0, 0, 1, 1), "ACCEPTED");
    equal(keys.admit(true, 0, 0, 1, 1), "DUPLICATE_DOWN");
    equal(keys.admit(true, 1, 0, 1, 1), "NOT_DOWN");
    equal(keys.admit(true, 0, 0, 1, 1), "DUPLICATE");
    equal(keys.admit(true, 0, 0, 2, 1), "ACCEPTED");
    for (int n = 2; n <= 1023; n++) {
      equal(keys.admit(true, 0, 0, 1, n), "ACCEPTED");
      equal(keys.admit(true, 1, 0, 1, n), "NOT_DOWN");
    }
    equal(keys.admit(true, 0, 0, 1, 1024), "CAPACITY");
    equal(keys.admit(true, 0, 0, 1, 1), "DUPLICATE");
    MarkerKeys zero = new MarkerKeys();
    for (int n = 0; n < 10; n++) {
      equal(zero.admit(true, 0, 0, -1, 0), "ACCEPTED");
      equal(zero.admit(true, 0, 0, -1, 0), "DUPLICATE_DOWN");
      equal(zero.admit(true, 1, 0, -1, 0), "NOT_DOWN");
    }
    System.out.println("Marker key policy: " + checks + " assertions passed");
  }
}
