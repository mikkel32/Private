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
      "cflags": [ "-s", "-O3", "-fvisibility=hidden", "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2" ],
      "cflags_cc": [ "-s", "-O3", "-fvisibility=hidden", "-fstack-protector-strong", "-D_FORTIFY_SOURCE=2" ],
      "ldflags": [ "-Wl,-s" ],
      "conditions": [
        ["OS=='mac'", {
          "sources": [ "src/native/secure_input.mm", "src/native/secure_kernel_mac.cpp" ],
          "xcode_settings": {
            "OTHER_LDFLAGS": [
              "-framework Carbon",
              "-framework AppKit",
              "-framework Foundation",
              "-framework SystemExtensions",
              "-framework IOKit",
              "-framework AVFoundation",
              "-framework CoreVideo",
              "-framework CoreMedia",
              "-framework VideoToolbox",
              "-framework QuartzCore",
              "-framework LocalAuthentication",
              "-framework Security",
              "-Wl,-S"
            ],
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "DEAD_CODE_STRIPPING": "YES",
            "GCC_GENERATE_DEBUGGING_SYMBOLS": "NO",
            "DEPLOYMENT_POSTPROCESSING": "YES",
            "STRIP_INSTALLED_PRODUCT": "YES"
          }
        }],
        ["OS=='win'", {
          "sources": [ "src/native/secure_input_win.cc" ],
          "msvs_settings": {
            "VCCLCompilerTool": { 
                "ExceptionHandling": 1,
                "DebugInformationFormat": 0,
                "Optimization": 3
            },
            "VCLinkerTool": {
                "GenerateDebugInformation": "false",
                "LinkIncremental": 1,
                "OptimizeReferences": 2,
                "EnableCOMDATFolding": 2
            }
          }
        }],
        ["OS=='linux'", {
          "sources": [ "src/native/secure_input_linux.cc" ],
          "libraries": [ "-lX11" ]
        }]
      ]
    }
  ]
}
