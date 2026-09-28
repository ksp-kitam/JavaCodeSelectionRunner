# JavaCode Selection Runner

This is an extension that allows you to execute selected portions of Java code.

It utilizes JShell, which has been available since Java 9.

## ■ Configuration

This extension operates using the internally maintained Java.

The internally maintained Java includes only essential modules.

* Information about the internally maintained Java:

	* Java Type: OpenJDK

	* Version: 21

	* Included Modules: java.base, java.compiler, java.logging, java.xml, java.prefs, jdk.internal.jvmstat, jdk.attach, jdk.internal.opt, jdk.zipfs, jdk.compiler, jdk.internal.ed, jdk.internal.le, jdk.jdwp.agent, jdk.jdi, jdk.jshell

* Supported platforms

	* The internally maintained Java is **for Windows only**.

	* **On platforms other than Windows (Linux / macOS), the java_home setting below is required.**
	  Without it, the extension shows "Java for this platform is not bundled." and stops.

If you need to make changes, open the VS Code settings and configure as follows:

* Location: Extensions >> JavaCodeSelectionRunner >> Java home

* Value: \<Java Installation Directory\>

If you prefer to directly edit the settings file (settings.json), add the following:

* JavaCodeSelectionRunner.java_home: "\<Java Installation Directory\>"

## ■ Code Completion

Shows completion candidates while you type Java code.

For example, typing `System.` shows `out` and `err` as candidates.

* Completion uses the Java bundled with this extension (via the JShell analysis API).

* A helper process starts on the first completion, so the first request takes a few seconds. After that, the resident process responds quickly.

* You can turn completion off in the settings.

	* Location: Extensions >> JavaCodeSelectionRunner >> Enable completion

	* settings.json: `JavaCodeSelectionRunner.enable_completion: false`

### Limitations

Because the JShell analysis API is used, candidates are limited in the following ways.

* Classes and variables declared above the cursor are reflected in the candidates (v1.3.1).

	For example, after writing `class Test { void ssssss() { } }` and `Test test = new Test();`, typing `test.` shows `ssssss()`.

* The provided methods such as `input()` also appear as candidates.

* The declarations are only compiled, never executed.

* Inside a class body (for example within a method), candidates may not appear. In that case, candidates are computed from the current line only.

## ■ Error Highlighting

Compile errors are underlined with a red squiggle while you type Java code.

Hover over the squiggle to see the error message (in Japanese). Errors are also listed in the Problems panel.

```java
Test test = new Test(1111);   // <- "incompatible types: int cannot be converted to java.lang.String"
```

* The whole file is checked about 0.5 seconds after you stop typing.

* The code is only compiled and is **never executed** (code that waits for input or loops forever is safe).

* The check uses the same conditions as execution. Omitted imports such as `Scanner` or `List`, and the provided methods such as `input()`, are not reported as errors.

* If a declaration has an error and a later line uses it, only the declaration is marked (the later line is not).

* The check uses the Java bundled with this extension. On platforms other than Windows, java_home must be set.

* You can turn error highlighting off in the settings.

	* Location: Extensions >> JavaCodeSelectionRunner >> Enable diagnostics

	* settings.json: `JavaCodeSelectionRunner.enable_diagnostics: false`

## ■ Formatting

You can format Java code with google-java-format.

* Format the whole file

	Choose "Format Document" from the right-click menu (default key binding: Shift+Alt+F).

* Format the selected range only

	Select the part you want to format and choose "Format Selection" from the right-click menu (default key binding: Ctrl+K Ctrl+F).

The formatting style is Google Java Style (2-space indentation).

Formatting also uses the Java bundled with this extension. On platforms other than Windows, the java_home setting is required.

## ■ Usage

Open a Java file, select the portion you want to execute, right-click, and choose "Run Java Code" from the context menu.

## ■ Available Methods

The extension provides the following methods during the execution of Java code:

* `String input()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as a String.

* `char inputToChar()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as a char.

  The first character of the input content is returned using String.charAt(0).

* `int inputToInt()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as an int.

  If the input content cannot be converted with Integer.parseInt(), an error occurs.

* `double inputToDouble()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as a double.

  If the input content cannot be converted with Double.parseDouble(), an error occurs.

* `long inputToLong()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as a long.

  If the input content cannot be converted with Long.parseLong(), an error occurs.

* `float inputToFloat()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as a float.

  If the input content cannot be converted with Float.parseFloat(), an error occurs.

* `int makeRandomValue(int start, int end)`

  Returns a random integer between start and end (both inclusive).

  Uses nextInt() of java.util.Random.

* `short inputToShort()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as a short.

  If the input content cannot be converted with Short.parseShort(), an error occurs.
