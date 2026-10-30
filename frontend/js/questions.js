/* =========================================================
   Quiz Builder – questions.js
   Master question bank containing 75 questions across 8 domains:
   - C Programming (Q1 - Q10)
   - C++ Programming (Q11 - Q20)
   - Java Programming (Q21 - Q30)
   - Python Programming (Q31 - Q40)
   - JavaScript (Q41 - Q50)
   - OOP Concepts (Q51 - Q60)
   - Data Structures & Algorithms (Q61 - Q70)
   - General Programming & Computer Concepts (Q71 - Q75)
   ========================================================= */

const DEFAULT_QUESTIONS = [
  // ⚡ C Programming
  {
    question: "Which keyword is used to declare a constant variable in C?",
    optionA: "constant",
    optionB: "const",
    optionC: "fixed",
    optionD: "final",
    correct: 1
  },
  {
    question: "Which format specifier is used to print an integer in C?",
    optionA: "%f",
    optionB: "%c",
    optionC: "%d",
    optionD: "%s",
    correct: 2
  },
  {
    question: "Which format specifier is used to print a character?",
    optionA: "%d",
    optionB: "%c",
    optionC: "%f",
    optionD: "%s",
    correct: 1
  },
  {
    question: "Which operator is used to access the value stored at a pointer address?",
    optionA: "&",
    optionB: "*",
    optionC: "#",
    optionD: "@",
    correct: 1
  },
  {
    question: "Which function is used to read formatted input in C?",
    optionA: "print()",
    optionB: "scanf()",
    optionC: "input()",
    optionD: "read()",
    correct: 1
  },
  {
    question: "Which keyword is used to define a structure in C?",
    optionA: "record",
    optionB: "struct",
    optionC: "class",
    optionD: "structure",
    correct: 1
  },
  {
    question: "What is the index of the first element of an array in C?",
    optionA: "0",
    optionB: "1",
    optionC: "-1",
    optionD: "Depends on the array",
    correct: 0
  },
  {
    question: "Which function is used to find the length of a string in C?",
    optionA: "length()",
    optionB: "strlen()",
    optionC: "strlength()",
    optionD: "size()",
    correct: 1
  },
  {
    question: "Which header file contains string functions such as strlen()?",
    optionA: "stdio.h",
    optionB: "stdlib.h",
    optionC: "string.h",
    optionD: "stringlib.h",
    correct: 2
  },
  {
    question: "Which statement is used to select one option from multiple choices in C?",
    optionA: "select",
    optionB: "switch",
    optionC: "choose",
    optionD: "option",
    correct: 1
  },

  // ⚡ C++ Programming
  {
    question: "Which symbol is used for scope resolution in C++?",
    optionA: ".",
    optionB: "::",
    optionC: "->",
    optionD: ":",
    correct: 1
  },
  {
    question: "Which feature allows multiple functions with the same name but different parameters?",
    optionA: "Overriding",
    optionB: "Overloading",
    optionC: "Inheritance",
    optionD: "Abstraction",
    correct: 1
  },
  {
    question: "Which operator is used to dynamically allocate memory in C++?",
    optionA: "malloc",
    optionB: "alloc",
    optionC: "new",
    optionD: "create",
    correct: 2
  },
  {
    question: "Which operator is used to release memory allocated using new?",
    optionA: "free",
    optionB: "remove",
    optionC: "delete",
    optionD: "clear",
    correct: 2
  },
  {
    question: "Which access specifier allows access from anywhere in C++?",
    optionA: "private",
    optionB: "protected",
    optionC: "public",
    optionD: "internal",
    correct: 2
  },
  {
    question: "Which function is automatically called when an object is created?",
    optionA: "Destructor",
    optionB: "Constructor",
    optionC: "Main function",
    optionD: "Static function",
    correct: 1
  },
  {
    question: "Which function is automatically called when an object is destroyed?",
    optionA: "Constructor",
    optionB: "Destructor",
    optionC: "Finalizer",
    optionD: "Delete function",
    correct: 1
  },
  {
    question: "Which symbol is commonly used before a destructor name in C++?",
    optionA: "!",
    optionB: "~",
    optionC: "#",
    optionD: "@",
    correct: 1
  },
  {
    question: "Which C++ feature supports multiple inheritance?",
    optionA: "Classes",
    optionB: "Functions",
    optionC: "Variables",
    optionD: "Operators",
    correct: 0
  },
  {
    question: "Which keyword can be used to prevent a class from being inherited in modern C++?",
    optionA: "final",
    optionB: "sealed",
    optionC: "stop",
    optionD: "private",
    correct: 0
  },

  // ☕ Java Programming
  {
    question: "Which keyword is used to create an interface in Java?",
    optionA: "Interface",
    optionB: "interface",
    optionC: "implements",
    optionD: "abstract",
    correct: 1
  },
  {
    question: "Which keyword is used to explicitly call the parent class constructor?",
    optionA: "parent",
    optionB: "base",
    optionC: "super",
    optionD: "this",
    correct: 2
  },
  {
    question: "Which keyword refers to the current object in Java?",
    optionA: "self",
    optionB: "current",
    optionC: "this",
    optionD: "object",
    correct: 2
  },
  {
    question: "Which Java collection does not allow duplicate elements?",
    optionA: "List",
    optionB: "Set",
    optionC: "ArrayList",
    optionD: "Vector",
    correct: 1
  },
  {
    question: "Which collection stores elements in key-value pairs?",
    optionA: "List",
    optionB: "Set",
    optionC: "Map",
    optionD: "Queue",
    correct: 2
  },
  {
    question: "Which class is commonly used for dynamically sized lists in Java?",
    optionA: "ArrayList",
    optionB: "Array",
    optionC: "DynamicList",
    optionD: "ListArray",
    correct: 0
  },
  {
    question: "Which keyword is used to define an abstract class?",
    optionA: "interface",
    optionB: "abstract",
    optionC: "virtual",
    optionD: "base",
    correct: 1
  },
  {
    question: "Which keyword is used to manually throw an exception in Java?",
    optionA: "throws",
    optionB: "throw",
    optionC: "exception",
    optionD: "error",
    correct: 1
  },
  {
    question: "Which keyword declares that a method may throw exceptions?",
    optionA: "throw",
    optionB: "throws",
    optionC: "try",
    optionD: "catch",
    correct: 1
  },
  {
    question: "Which block is executed whether an exception occurs or not?",
    optionA: "try",
    optionB: "catch",
    optionC: "finally",
    optionD: "error",
    correct: 2
  },

  // 🐍 Python Programming
  {
    question: "Which function is used to accept input from the user in Python?",
    optionA: "read()",
    optionB: "scanf()",
    optionC: "input()",
    optionD: "get()",
    correct: 2
  },
  {
    question: "Which operator is used for exponentiation in Python?",
    optionA: "^",
    optionB: "**",
    optionC: "^^",
    optionD: "//",
    correct: 1
  },
  {
    question: "What is the output of print(2 ** 3)?",
    optionA: "5",
    optionB: "6",
    optionC: "8",
    optionD: "9",
    correct: 2
  },
  {
    question: "Which method adds an element to the end of a Python list?",
    optionA: "add()",
    optionB: "insertEnd()",
    optionC: "append()",
    optionD: "push()",
    correct: 2
  },
  {
    question: "Which method removes the last element from a Python list?",
    optionA: "delete()",
    optionB: "removeLast()",
    optionC: "pop()",
    optionD: "drop()",
    correct: 2
  },
  {
    question: "Which method converts a string to lowercase in Python?",
    optionA: "lower()",
    optionB: "small()",
    optionC: "tolower()",
    optionD: "lowercase()",
    correct: 0
  },
  {
    question: "Which method splits a string into a list?",
    optionA: "divide()",
    optionB: "split()",
    optionC: "separate()",
    optionD: "break()",
    correct: 1
  },
  {
    question: "Which symbol represents a tuple in Python?",
    optionA: "[]",
    optionB: "{}",
    optionC: "()",
    optionD: "<>",
    correct: 2
  },
  {
    question: "Which Python data structure automatically removes duplicate values?",
    optionA: "List",
    optionB: "Tuple",
    optionC: "Set",
    optionD: "Dictionary",
    correct: 2
  },
  {
    question: "What does None represent in Python?",
    optionA: "Zero",
    optionB: "Empty string",
    optionC: "No value / absence of value",
    optionD: "False only",
    correct: 2
  },

  // 🌐 JavaScript
  {
    question: "Which keyword can be used to declare a variable in JavaScript?",
    optionA: "variable",
    optionB: "let",
    optionC: "define",
    optionD: "declare",
    correct: 1
  },
  {
    question: "Which keyword declares a constant in JavaScript?",
    optionA: "constant",
    optionB: "fixed",
    optionC: "const",
    optionD: "final",
    correct: 2
  },
  {
    question: "Which function is commonly used to display a message in the browser console?",
    optionA: "print()",
    optionB: "console.log()",
    optionC: "display()",
    optionD: "writeConsole()",
    correct: 1
  },
  {
    question: "Which symbol starts a single-line comment in JavaScript?",
    optionA: "#",
    optionB: "//",
    optionC: "<!--",
    optionD: "**",
    correct: 1
  },
  {
    question: "Which operator checks both value and type in JavaScript?",
    optionA: "=",
    optionB: "==",
    optionC: "===",
    optionD: "!=",
    correct: 2
  },
  {
    question: "Which method adds an element to the end of a JavaScript array?",
    optionA: "append()",
    optionB: "push()",
    optionC: "add()",
    optionD: "insert()",
    correct: 1
  },
  {
    question: "Which method removes the last element from a JavaScript array?",
    optionA: "pop()",
    optionB: "remove()",
    optionC: "deleteLast()",
    optionD: "shift()",
    correct: 0
  },
  {
    question: "Which method converts JSON text into a JavaScript object?",
    optionA: "JSON.convert()",
    optionB: "JSON.parse()",
    optionC: "JSON.object()",
    optionD: "JSON.read()",
    correct: 1
  },
  {
    question: "Which keyword is used to define a function in JavaScript?",
    optionA: "function",
    optionB: "def",
    optionC: "fun",
    optionD: "method",
    correct: 0
  },
  {
    question: "Which language is primarily used to add interactivity to web pages?",
    optionA: "HTML",
    optionB: "CSS",
    optionC: "JavaScript",
    optionD: "SQL",
    correct: 2
  },

  // 🧩 OOP Concepts
  {
    question: "What is a class?",
    optionA: "A blueprint for creating objects",
    optionB: "A variable",
    optionC: "A loop",
    optionD: "A database",
    correct: 0
  },
  {
    question: "What is an object?",
    optionA: "An instance of a class",
    optionB: "A compiler",
    optionC: "A function only",
    optionD: "A data type",
    correct: 0
  },
  {
    question: "Which OOP principle protects data from direct access?",
    optionA: "Inheritance",
    optionB: "Encapsulation",
    optionC: "Polymorphism",
    optionD: "Compilation",
    correct: 1
  },
  {
    question: "Which relationship represents an \"is-a\" relationship?",
    optionA: "Composition",
    optionB: "Inheritance",
    optionC: "Aggregation",
    optionD: "Association",
    correct: 1
  },
  {
    question: "Which relationship represents a \"has-a\" relationship?",
    optionA: "Inheritance",
    optionB: "Composition",
    optionC: "Overloading",
    optionD: "Polymorphism",
    correct: 1
  },
  {
    question: "What is method overriding?",
    optionA: "Defining a method with the same signature in a child class",
    optionB: "Creating two variables",
    optionC: "Deleting a method",
    optionD: "Calling a method twice",
    correct: 0
  },
  {
    question: "What is method overloading?",
    optionA: "Same method name with different parameters",
    optionB: "Same variable with different values",
    optionC: "Deleting methods",
    optionD: "Hiding all methods",
    correct: 0
  },
  {
    question: "Which OOP concept focuses on showing only essential information?",
    optionA: "Abstraction",
    optionB: "Inheritance",
    optionC: "Compilation",
    optionD: "Overloading",
    correct: 0
  },
  {
    question: "Which OOP concept promotes code reuse through parent-child relationships?",
    optionA: "Encapsulation",
    optionB: "Inheritance",
    optionC: "Abstraction",
    optionD: "Exception handling",
    correct: 1
  },
  {
    question: "Which of the following is NOT one of the four main OOP principles?",
    optionA: "Encapsulation",
    optionB: "Inheritance",
    optionC: "Polymorphism",
    optionD: "Compilation",
    correct: 3
  },

  // 📚 Data Structures & Algorithms
  {
    question: "Which data structure is used to implement function calls?",
    optionA: "Queue",
    optionB: "Stack",
    optionC: "Graph",
    optionD: "Tree",
    correct: 1
  },
  {
    question: "Which data structure is commonly used for printer job scheduling?",
    optionA: "Stack",
    optionB: "Queue",
    optionC: "Tree",
    optionD: "Graph",
    correct: 1
  },
  {
    question: "Which data structure has nodes connected through edges?",
    optionA: "Array",
    optionB: "Graph",
    optionC: "Stack",
    optionD: "Queue",
    correct: 1
  },
  {
    question: "Which data structure has a root node and child nodes?",
    optionA: "Tree",
    optionB: "Stack",
    optionC: "Queue",
    optionD: "Array",
    correct: 0
  },
  {
    question: "Which traversal visits the root before its subtrees?",
    optionA: "Inorder",
    optionB: "Postorder",
    optionC: "Preorder",
    optionD: "Reverse order",
    correct: 2
  },
  {
    question: "In a binary search tree, which traversal gives elements in sorted order?",
    optionA: "Preorder",
    optionB: "Postorder",
    optionC: "Inorder",
    optionD: "Level order",
    correct: 2
  },
  {
    question: "Which algorithm is commonly used to find the shortest path in a weighted graph with non-negative edges?",
    optionA: "Dijkstra's algorithm",
    optionB: "Bubble Sort",
    optionC: "Binary Search",
    optionD: "DFS",
    correct: 0
  },
  {
    question: "Which algorithm explores a graph level by level?",
    optionA: "DFS",
    optionB: "BFS",
    optionC: "Binary Search",
    optionD: "Selection Sort",
    correct: 1
  },
  {
    question: "Which algorithm explores as far as possible along a branch before backtracking?",
    optionA: "BFS",
    optionB: "DFS",
    optionC: "Dijkstra",
    optionD: "Merge Sort",
    correct: 1
  },
  {
    question: "Which sorting algorithm uses a divide-and-conquer approach?",
    optionA: "Bubble Sort",
    optionB: "Merge Sort",
    optionC: "Linear Search",
    optionD: "Selection Sort",
    correct: 1
  },

  // 🔐 General Programming & Computer Concepts
  {
    question: "What does API stand for?",
    optionA: "Application Programming Interface",
    optionB: "Application Processing Internet",
    optionC: "Advanced Programming Input",
    optionD: "Automated Program Interface",
    correct: 0
  },
  {
    question: "What does SQL primarily manage?",
    optionA: "Images",
    optionB: "Databases",
    optionC: "Operating systems",
    optionD: "Computer hardware",
    correct: 1
  },
  {
    question: "Which HTTP method is commonly used to retrieve data?",
    optionA: "POST",
    optionB: "GET",
    optionC: "DELETE",
    optionD: "PATCH",
    correct: 1
  },
  {
    question: "Which HTTP status code generally indicates \"Not Found\"?",
    optionA: "200",
    optionB: "301",
    optionC: "404",
    optionD: "500",
    correct: 2
  },
  {
    question: "What does JSON stand for?",
    optionA: "Java Standard Object Notation",
    optionB: "JavaScript Object Notation",
    optionC: "Java Source Object Network",
    optionD: "JavaScript Online Network",
    correct: 1
  }
];

// Questions are stored and managed directly in MongoDB Atlas.
function syncDefaultQuestions() {
  // No-op: LocalStorage question caching removed to enforce central MongoDB authority.
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_QUESTIONS, syncDefaultQuestions };
}
