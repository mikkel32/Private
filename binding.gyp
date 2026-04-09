{
  "targets": [
    {
      "target_name": "secure_input",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "src/native/secure_input.mm" ],
          "xcode_settings": {
            "OTHER_LDFLAGS": [
              "-framework Carbon",
              "-framework AppKit",
              "-framework Foundation"
            ],
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15"
          }
        }],
        ["OS=='win'", {
          "sources": [ "src/native/secure_input_win.cc" ],
          "msvs_settings": {
            "VCCLCompilerTool": { "ExceptionHandling": 1 }
          }
        }],
        ["OS=='linux'", {
          "sources": [ "src/native/secure_input_linux.cc" ]
        }]
      ]
    }
  ]
}
