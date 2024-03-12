# JavaCode Selection Runner

This is an extension that allows you to execute selected portions of Java code.

It utilizes JShell, which has been available since Java 9.

## ■ Configuration

This extension operates using the internally maintained Java.

The internally maintained Java includes only essential modules.

* Information about the internally maintained Java:

	* Java Type: OpenJDK

	* Version: 11

	* Included Modules: java.base, jdk.jshell

If you need to make changes, open the VS Code settings and configure as follows:

* Location: Extensions >> JavaSimpleEnvironment >> Java_home

* Value: \<Java Installation Directory\>

If you prefer to directly edit the settings file (settings.json), add the following:

* JavaSimpleEnvironment.java_home: "\<Java Installation Directory\>"

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

* `short inputToShort()`

  Creates an object of the Scanner class, calls nextLine(), and retrieves the entered content.

  The obtained value is returned as a short.

  If the input content cannot be converted with Short.parseShort(), an error occurs.
