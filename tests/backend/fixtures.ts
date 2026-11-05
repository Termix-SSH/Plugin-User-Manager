export const LIST = `@@TERMIX@@PASSWD
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
deploy:x:1000:1000:Deploy User,,,:/home/deploy:/bin/bash
alice:x:1001:1001:Alice:/home/alice:/bin/zsh
old:x:1002:1002::/home/old:/bin/bash
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
@@TERMIX@@GROUP
root:x:0:
sudo:x:27:deploy
docker:x:999:deploy,alice
deploy:x:1000:
alice:x:1001:
old:x:1002:
devs:x:1003:alice
nogroup:x:65534:
@@TERMIX@@SHADOW
root:*:20000:0:99999:7:::
daemon:*:20000:0:99999:7:::
deploy:$y$j9T$abc:20300:0:99999:7:::
alice::20300:0:99999:7:::
old:!$y$j9T$def:20100:0:99999:7::1:
nobody:*:20000:0:99999:7:::
@@TERMIX@@ME deploy
@@TERMIX@@NOW 1762000000
`;
