var fs = require('fs');
// const request = require('request');
// const cheerio = require('cheerio');
// const axios = require('axios');
const program = require('commander');
var {parse} = require('csv-parse');
const download = require('download');
const {Octokit} = require("@octokit/core");
const octokit = new Octokit({auth: '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'})

//Download Package.json from "download.url"
async function DownloadFile(url, repo) {
  filepath = __dirname + "/files/" + repo;
  return download(url, filepath).then(() => {
    var res = require(filepath + "/package.json");
    return res;
  })
}

//Open and parse downloaded package.json and extract and return the version of requested dependency
async function GetDependencyVersion(repo, dependency) {
  var response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner: 'dyte-in',
    repo: repo,
    path: 'package.json',
  }).catch((err) => {
    console.log(err);
  });
//   console.log(response.data.download_url);
  var file = await DownloadFile(response.data.download_url, repo);
  try {
    var ver = file.dependencies[dependency].substring(1);
  } catch (error) {
    console.log(error);
    var ver = "Dependency not found";
  }
  return [file, ver];
}


//Compare versions of dependency of concern
async function VersionComparator(req, curr) {
//   console.log(req, curr);
  if (curr == "Dependency not found")
    return "null";
  var v1 = req.split(/[.]/);
  var v2 = curr.split(/[.]/);
  for (var i = 0; i < req.length; i++) {
    if (parseInt(v2[i]) < parseInt(v1[i]))
      return false;
    else if (parseInt(v2[i]) > parseInt(v1[i]))
      return true;
  }
  return true;
}


//Create a Pull request for the commits
async function CreatePR(owner, repo, forked_owner) {
  var pr_url
  await octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner: owner,
    repo: repo,
    body: 'Required dependency changes',
    title: 'Please update dependency',
    head: forked_owner + ':main',
    base: 'main'
  }).then((response) => {
    pr_url = response.data.html_url;
  }).catch((err)=>{
    pr_url = "Error while creating PR";
  })
  return pr_url;
}


//Commit the changes done
async function CommitChanges(forked_owner, repo, file, sha_blob) {
  try {
    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', { //PUT request, commiting the changes
      owner: forked_owner,
      repo: repo,
      path: 'package.json',
      message: 'Commiting change in dependency',
      content: file, //new content of package.json
      sha: sha_blob
    })
  } catch (error) {
    console.log(error);
  }
}

//Fork the owner's repo, Get the SHA blob of the "package.json" file and excute Commit and createPR functions
async function GeneratePR(owner, repo, file) {
  var pr_url;
  try {
    await octokit.request('POST /repos/{owner}/{repo}/forks', { // Creating Fork Repository
      owner: owner,
      repo: repo
    }).then(async (response) => {
      var forked_owner = response.data.owner.login; 
      await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { //Getting SHA BLOB of the package.json
        owner: forked_owner,
        repo: repo,
        path: "package.json"
      }).then(async (response) => {
        var sha_blob = response.data.sha;
        await CommitChanges(forked_owner, repo, file, sha_blob);

        pr_url = await CreatePR(owner, repo, forked_owner);
      })
    })
    return pr_url
  } catch (err) {
    console.log(err);
  }
}


//Heart of command line
program
  .command('check <filename> <dependency> <version>')
  .option('-i', 'Check dependency version') //option for just checking the versions
  .option('-u, -update', 'Generate PR for updation') //option for updation of PR
  .action((filename, dependency, version, option) => {
    // console.log(option);

    //open and read csv file
    fs.createReadStream(__dirname + "/" + filename).pipe(parse({columns: true},
      async function (err, records) {

        //A loop to iterate through all the entries in csv file
        for (var i = 0; i < records.length; i++) {

          suffix = records[i].repo.split(/[/]/); //splitting the given string to get owner's name (dyte-in) and repo names

          var [file, ver] = await GetDependencyVersion(suffix[4], dependency); //Get Dependency version and package.json file
          var ver_sat = await VersionComparator(version, ver); // Comapre versions of dependencies 

          //Append results to the records
          records[i].version = ver;
          records[i].version_satisfied = ver_sat;

          //If -u/-update is given, and version isn't satisfied, exceute and get a PR
          if (option.Update && records[i].version_satisfied == false) {

            file.dependencies[dependency] = "^" + version; //Change version in JSON 
            file = Buffer.from(JSON.stringify(file)).toString("base64"); // Base64 encoding to push the change 

            var pr = await GeneratePR(suffix[3], suffix[4], file); //Get pr link
            records[i].update_pr = pr;
          }
        }
        console.table(records); //For a tabulated output
      }))
  });

program.parse(process.argv);