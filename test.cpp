#include<iostream>
using namespace std;

string a,b;

string sub(string a,string b)
{
    while(b.size()<a.size()) b='0'+b;
    int n=a.size();
    string f="";
    if(a<b) f=="-",swap(a,b);
    string ans(n+1,'0');
    for(int i=0;i<n;++i)
    {
        ans[n-i]+=a[n-i-1]-'0';
        ans[n-i]-=b[n-i-1]-'0';
        if(ans[n-i]<'0') ans[n-i-1]--,ans[n-i]+=10;
    }
    int p=0;while(p<ans.size()-1 and ans[p]=='0') p++;
    cout<<f<<endl;
    return f+ans.substr(p);
}

int main()
{
    cin>>a>>b;
    cout<<sub(a,b);
    return 0;
}
