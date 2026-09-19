class GreetingHelper {
  GreetingHelper._();

  /// Determines the greeting string based on the provided or current hour of day
  static String getGreeting({DateTime? dateTime, String name = 'Admin'}) {
    final now = dateTime ?? DateTime.now();
    final hour = now.hour;

    String greeting;
    if (hour >= 5 && hour < 12) {
      greeting = 'Good morning';
    } else if (hour >= 12 && hour < 17) {
      greeting = 'Good afternoon';
    } else if (hour >= 17 && hour < 22) {
      greeting = 'Good evening';
    } else {
      greeting = 'Good night';
    }

    return '$greeting, $name 👋';
  }
}
